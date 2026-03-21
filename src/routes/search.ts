import { Router, type IRouter, type Request, type Response } from "express";
import linkedinPool from "../lib/db.js";
import {
  buildTsQuery,
  getSubsetOffset,
  SUBSET_SIZE,
  PAGE_SIZE,
} from "../lib/searchQuery.js";

const router: IRouter = Router();

// ---------------------------------------------------------------------------
// GET /api/search/count
// Returns total matching profiles and how many subsets they split into.
// Call this first; use the returned values when calling /profiles.
// ---------------------------------------------------------------------------
router.get("/count", async (req: Request, res: Response) => {
  const { skills, designation } = req.query as {
    skills?: string;
    designation?: string;
  };

  if (!skills && !designation) {
    res
      .status(400)
      .json({ error: "At least one of skills or designation is required" });
    return;
  }

  const tsq = buildTsQuery(skills, designation);
  if (!tsq) {
    res
      .status(400)
      .json({ error: "Could not build a valid search query from the provided input" });
    return;
  }

  try {
    const result = await linkedinPool.query<{ total: string }>(
      `
      WITH q AS (
        SELECT to_tsquery('english', $1) AS tsq
      )
      SELECT COUNT(ps.profile_id) AS total
      FROM   linkedin.profile_search ps,  q
      WHERE  ps.tsv_search @@ q.tsq
      `,
      [tsq]
    );

    const total   = parseInt(result.rows[0].total, 10);
    const subsets = Math.ceil(total / SUBSET_SIZE);

    res.json({ total, subsets, subsetSize: SUBSET_SIZE });
  } catch (err) {
    req.log.error({ err }, "Search count error");
    res.status(500).json({ error: "Search failed" });
  }
});

// ---------------------------------------------------------------------------
// GET /api/search/profiles
// Returns a page of ranked profiles for the given subset.
// Does NOT re-count — call /count first to get total/subsets.
// ---------------------------------------------------------------------------
router.get("/profiles", async (req: Request, res: Response) => {
  const { skills, designation } = req.query as {
    skills?: string;
    designation?: string;
  };
  const subset = Math.max(0, parseInt((req.query.subset as string) ?? "0", 10) || 0);
  const page   = Math.max(1, parseInt((req.query.page   as string) ?? "1", 10) || 1);

  if (!skills && !designation) {
    res
      .status(400)
      .json({ error: "At least one of skills or designation is required" });
    return;
  }

  const tsq = buildTsQuery(skills, designation);
  if (!tsq) {
    res.status(400).json({ error: "Could not build a valid search query" });
    return;
  }

  const subsetOffset = getSubsetOffset(subset);                    // subset * 1000
  const pageOffset   = (page - 1) * PAGE_SIZE;                    // (page-1) * 20
  const totalPages   = Math.ceil(SUBSET_SIZE / PAGE_SIZE);        // 1000 / 20 = 50

  try {
    const profilesResult = await linkedinPool.query(
      `
      WITH q AS (
        SELECT to_tsquery('english', $1) AS tsq
      ),
      -- Step 1: pull the 1 000-profile window for this subset
      filtered AS (
        SELECT   ps.profile_id
        FROM     linkedin.profile_search ps,  q
        WHERE    ps.tsv_search @@ q.tsq
        ORDER BY ts_rank_cd(ps.tsv_search, q.tsq) DESC
        LIMIT    $2  OFFSET $3
      ),
      -- Step 2: score each profile using columns on profile_search directly
      scored AS (
        SELECT
          f.profile_id,
          (
            ts_rank_cd(ps.tsv_headline,                  q.tsq) * 1.0 +
            ts_rank_cd(ps.tsv_active_experience_title,   q.tsq) * 0.9 +
            ts_rank_cd(ps.tsv_experience_title,          q.tsq) * 0.8 +
            ts_rank_cd(ps.tsv_experience_description,    q.tsq) * 0.7 +
            ts_rank_cd(ps.tsv_summary,                   q.tsq) * 0.5 +
            ts_rank_cd(ps.tsv_skill,                     q.tsq) * 0.2
          ) AS score
        FROM   filtered f
        JOIN   linkedin.profile_search ps ON ps.profile_id = f.profile_id
        CROSS  JOIN q
        ORDER  BY score DESC
        LIMIT  $4  OFFSET $5
      )
      -- Step 3: hydrate with profile + active-experience columns
      SELECT
        p.id,
        p.full_name,
        p.headline,
        p.picture_url,
        p.location_full,
        p.location_city,
        p.location_country,
        p.active_experience_title,
        p.linkedin_url,
        e.company_name       AS active_experience_company_name,
        e.company_logo_url   AS active_experience_company_logo_url,
        sc.score
      FROM   scored sc
      JOIN   linkedin.profiles p  ON p.id = sc.profile_id
      LEFT   JOIN linkedin.profile_experiences e
                ON  e.profile_id       = p.id
               AND e.active_experience = true
               AND e.order_in_profile  = 1
      ORDER  BY sc.score DESC
      `,
      [tsq, SUBSET_SIZE, subsetOffset, PAGE_SIZE, pageOffset]
    );

    const profiles = profilesResult.rows.map((row) => ({
      id:                                  String(row.id),
      full_name:                           row.full_name                ?? "",
      headline:                            row.headline                 ?? undefined,
      picture_url:                         row.picture_url              ?? undefined,
      location_full:                       row.location_full            ?? undefined,
      location_city:                       row.location_city            ?? undefined,
      location_country:                    row.location_country         ?? undefined,
      active_experience_title:             row.active_experience_title  ?? undefined,
      active_experience_company_name:      row.active_experience_company_name     ?? undefined,
      active_experience_company_logo_url:  row.active_experience_company_logo_url ?? undefined,
      linkedin_url:                        row.linkedin_url             ?? undefined,
      score:                               parseFloat(row.score) || 0,
    }));

    res.json({ profiles, subset, page, totalPages, subsetSize: SUBSET_SIZE });
  } catch (err) {
    req.log.error({ err }, "Search profiles error");
    res.status(500).json({ error: "Search failed" });
  }
});

// ---------------------------------------------------------------------------
// GET /api/search/profile/:profileId
// ---------------------------------------------------------------------------
router.get("/profile/:profileId", async (req: Request, res: Response) => {
  const { profileId } = req.params;

  try {
    const profileResult = await linkedinPool.query(
      `
      SELECT
        p.id, p.full_name, p.headline, p.picture_url,
        p.location_full, p.location_city, p.location_country,
        p.summary, p.linkedin_url,
        p.connections_count, p.followers_count,
        p.active_experience_title,
        p.total_experience_duration_months
      FROM linkedin.profiles p
      WHERE p.id = $1
      `,
      [profileId]
    );

    if (profileResult.rows.length === 0) {
      res.status(404).json({ error: "Profile not found" });
      return;
    }

    // Helper: run a query and return [] on any error (table may not exist)
    const safeQuery = async (sql: string, params: unknown[]) => {
      try {
        const r = await linkedinPool.query(sql, params);
        return r.rows;
      } catch {
        return [];
      }
    };

    const [
      experiencesRows,
      educationsRows,
      skillsRows,
      certificationsRows,
      honorsRows,
      publicationsRows,
      patentsRows,
      volunteeringRows,
      languagesRows,
      projectsRows,
      coursesRows,
    ] = await Promise.all([
      linkedinPool.query(
        `SELECT id, position_title, company_name, company_logo_url, company_industry,
                location, date_from, date_to, description, active_experience, duration_months
         FROM linkedin.profile_experiences WHERE profile_id = $1 ORDER BY order_in_profile ASC`,
        [profileId]
      ).then(r => r.rows),
      linkedinPool.query(
        `SELECT id, institution_name, institution_logo_url, degree, date_from_year, date_to_year
         FROM linkedin.profile_educations WHERE profile_id = $1 ORDER BY order_in_profile ASC`,
        [profileId]
      ).then(r => r.rows),
      linkedinPool.query(
        `SELECT skill_name FROM linkedin.profile_skills WHERE profile_id = $1 ORDER BY id ASC`,
        [profileId]
      ).then(r => r.rows),
      safeQuery(
        `SELECT id, certification_name, authority, license_number, url, date_from, date_to
         FROM linkedin.profile_certifications WHERE profile_id = $1 ORDER BY order_in_profile ASC`,
        [profileId]
      ),
      safeQuery(
        `SELECT id, title, issuer, date, description
         FROM linkedin.profile_honors WHERE profile_id = $1 ORDER BY order_in_profile ASC`,
        [profileId]
      ),
      safeQuery(
        `SELECT id, title, publisher, date, description, url
         FROM linkedin.profile_publications WHERE profile_id = $1 ORDER BY order_in_profile ASC`,
        [profileId]
      ),
      safeQuery(
        `SELECT id, title, status, number, date, description, url
         FROM linkedin.profile_patents WHERE profile_id = $1 ORDER BY order_in_profile ASC`,
        [profileId]
      ),
      safeQuery(
        `SELECT id, role, company_name, cause, date_from, date_to, description
         FROM linkedin.profile_volunteering WHERE profile_id = $1 ORDER BY order_in_profile ASC`,
        [profileId]
      ),
      safeQuery(
        `SELECT id, language_name, proficiency
         FROM linkedin.profile_languages WHERE profile_id = $1 ORDER BY order_in_profile ASC`,
        [profileId]
      ),
      safeQuery(
        `SELECT id, title, date_from, date_to, description, url
         FROM linkedin.profile_projects WHERE profile_id = $1 ORDER BY order_in_profile ASC`,
        [profileId]
      ),
      safeQuery(
        `SELECT id, course_name, number
         FROM linkedin.profile_courses WHERE profile_id = $1 ORDER BY order_in_profile ASC`,
        [profileId]
      ),
    ]);

    const row = profileResult.rows[0];

    res.json({
      id:                               String(row.id),
      full_name:                        row.full_name                        ?? "",
      headline:                         row.headline                         ?? undefined,
      picture_url:                      row.picture_url                      ?? undefined,
      location_full:                    row.location_full                    ?? undefined,
      location_city:                    row.location_city                    ?? undefined,
      location_country:                 row.location_country                 ?? undefined,
      summary:                          row.summary                          ?? undefined,
      linkedin_url:                     row.linkedin_url                     ?? undefined,
      connections_count:                row.connections_count                ?? undefined,
      followers_count:                  row.followers_count                  ?? undefined,
      active_experience_title:          row.active_experience_title          ?? undefined,
      total_experience_duration_months: row.total_experience_duration_months ?? undefined,
      experiences: experiencesRows.map((e) => ({
        id:                e.id,
        position_title:    e.position_title    ?? undefined,
        company_name:      e.company_name      ?? undefined,
        company_logo_url:  e.company_logo_url  ?? undefined,
        company_industry:  e.company_industry  ?? undefined,
        location:          e.location          ?? undefined,
        date_from:         e.date_from         ?? undefined,
        date_to:           e.date_to           ?? undefined,
        description:       e.description       ?? undefined,
        active_experience: e.active_experience ?? undefined,
        duration_months:   e.duration_months   ?? undefined,
      })),
      educations: educationsRows.map((e) => ({
        id:                   e.id,
        institution_name:     e.institution_name     ?? undefined,
        institution_logo_url: e.institution_logo_url ?? undefined,
        degree:               e.degree               ?? undefined,
        date_from_year:       e.date_from_year       ?? undefined,
        date_to_year:         e.date_to_year         ?? undefined,
      })),
      skills: skillsRows.map((s) => ({ skill_name: s.skill_name ?? undefined })),
      certifications: certificationsRows.map((c) => ({
        id:               c.id,
        certification_name: c.certification_name ?? undefined,
        authority:        c.authority        ?? undefined,
        license_number:   c.license_number   ?? undefined,
        url:              c.url              ?? undefined,
        date_from:        c.date_from        ?? undefined,
        date_to:          c.date_to          ?? undefined,
      })),
      honors: honorsRows.map((h) => ({
        id:          h.id,
        title:       h.title       ?? undefined,
        issuer:      h.issuer      ?? undefined,
        date:        h.date        ?? undefined,
        description: h.description ?? undefined,
      })),
      publications: publicationsRows.map((p) => ({
        id:          p.id,
        title:       p.title       ?? undefined,
        publisher:   p.publisher   ?? undefined,
        date:        p.date        ?? undefined,
        description: p.description ?? undefined,
        url:         p.url         ?? undefined,
      })),
      patents: patentsRows.map((p) => ({
        id:          p.id,
        title:       p.title       ?? undefined,
        status:      p.status      ?? undefined,
        number:      p.number      ?? undefined,
        date:        p.date        ?? undefined,
        description: p.description ?? undefined,
        url:         p.url         ?? undefined,
      })),
      volunteering: volunteeringRows.map((v) => ({
        id:           v.id,
        role:         v.role         ?? undefined,
        company_name: v.company_name ?? undefined,
        cause:        v.cause        ?? undefined,
        date_from:    v.date_from    ?? undefined,
        date_to:      v.date_to      ?? undefined,
        description:  v.description  ?? undefined,
      })),
      languages: languagesRows.map((l) => ({
        id:            l.id,
        language_name: l.language_name ?? undefined,
        proficiency:   l.proficiency   ?? undefined,
      })),
      projects: projectsRows.map((p) => ({
        id:          p.id,
        title:       p.title       ?? undefined,
        date_from:   p.date_from   ?? undefined,
        date_to:     p.date_to     ?? undefined,
        description: p.description ?? undefined,
        url:         p.url         ?? undefined,
      })),
      courses: coursesRows.map((c) => ({
        id:          c.id,
        course_name: c.course_name ?? undefined,
        number:      c.number      ?? undefined,
      })),
    });
  } catch (err) {
    req.log.error({ err }, "Profile detail error");
    res.status(500).json({ error: "Failed to fetch profile" });
  }
});

export default router;
