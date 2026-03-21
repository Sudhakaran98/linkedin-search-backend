import { Router, type IRouter, type Request, type Response } from "express";
import linkedinPool from "../lib/db.js";
import {
  buildTsQuery,
  getSubsetOffset,
  SUBSET_SIZE,
  PAGE_SIZE,
} from "../lib/searchQuery.js";

const router: IRouter = Router();

async function estimateSearchCount(tsq: string): Promise<number> {
  const result = await linkedinPool.query<{ total: number | string | null }>(
    `SELECT linkedin.count_estimate_tsv($1) AS total`,
    [tsq]
  );

  const estimatedTotal = result.rows[0]?.total;
  return Math.max(0, Number(estimatedTotal) || 0);
}

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
    const total = await estimateSearchCount(tsq);
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

  try {
    const total = await estimateSearchCount(tsq);
    const subsets = Math.ceil(total / SUBSET_SIZE);
    const profilesInSubset = Math.max(0, Math.min(SUBSET_SIZE, total - subsetOffset));
    const totalPages = profilesInSubset > 0 ? Math.ceil(profilesInSubset / PAGE_SIZE) : 0;

    const profilesQuery = `
      WITH q AS (
        SELECT to_tsquery('english', $1) AS tsq
      ),
      -- Step 1: pull the 1 000-profile window for this subset
      filtered AS (
        SELECT   ps.profile_id
        FROM     linkedin.profile_search ps,  q
        WHERE    ps.tsv_search @@ q.tsq
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
      `;
    const profilesQueryParams = [tsq, SUBSET_SIZE, subsetOffset, PAGE_SIZE, pageOffset];

    console.log("/api/search/profiles query", {
      inputs: {
        skills: skills ?? null,
        designation: designation ?? null,
        subset,
        page,
      },
      query: profilesQuery,
      params: profilesQueryParams,
    });

    const profilesResult = await linkedinPool.query(profilesQuery, profilesQueryParams);

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

    res.json({
      profiles,
      total,
      subsets,
      subset,
      page,
      totalPages,
      subsetSize: SUBSET_SIZE,
    });
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
      awardsRows,
      publicationsRows,
      patentsRows,
      languagesRows,
      projectsRows,
      coursesRows,
      organizationsRows,
    ] = await Promise.all([
      safeQuery(
        `SELECT id, position_title, company_name, company_logo_url, company_industry,
                location, date_from, date_to, date_from_year, date_from_month,
                date_to_year, date_to_month, description, active_experience, duration_months,
                department, management_level
         FROM linkedin.profile_experiences WHERE profile_id = $1 ORDER BY order_in_profile ASC`,
        [profileId]
      ),
      safeQuery(
        `SELECT id, institution_name, institution_logo_url, institution_url, degree,
                date_from_year, date_to_year, description, activities_and_societies
         FROM linkedin.profile_educations WHERE profile_id = $1 ORDER BY order_in_profile ASC`,
        [profileId]
      ),
      safeQuery(
        `SELECT id, skill_name, is_inferred
         FROM linkedin.profile_skills WHERE profile_id = $1 ORDER BY id ASC`,
        [profileId]
      ),
      safeQuery(
        `SELECT id, title, issuer, issuer_url, credential_id, certificate_url,
                certificate_logo_url, date_from, date_from_year, date_from_month,
                date_to, date_to_year, date_to_month
         FROM linkedin.profile_certifications WHERE profile_id = $1 ORDER BY order_in_profile ASC`,
        [profileId]
      ),
      safeQuery(
        `SELECT id, award_title, issuer, description, award_date, date_year, date_month
         FROM linkedin.profile_awards WHERE profile_id = $1 ORDER BY order_in_profile ASC`,
        [profileId]
      ),
      safeQuery(
        `SELECT id, title, description, publication_url, publication_names, date, date_year, date_month
         FROM linkedin.profile_publications WHERE profile_id = $1 ORDER BY order_in_profile ASC`,
        [profileId]
      ),
      safeQuery(
        `SELECT id, title, description, patent_url, patent_number, status, date, date_year, date_month
         FROM linkedin.profile_patents WHERE profile_id = $1 ORDER BY order_in_profile ASC`,
        [profileId]
      ),
      safeQuery(
        `SELECT id, language_name, proficiency
         FROM linkedin.profile_languages WHERE profile_id = $1 ORDER BY order_in_profile ASC`,
        [profileId]
      ),
      safeQuery(
        `SELECT id, name, description, project_url, date_from, date_from_year, date_from_month,
                date_to, date_to_year, date_to_month
         FROM linkedin.profile_projects WHERE profile_id = $1 ORDER BY order_in_profile ASC`,
        [profileId]
      ),
      safeQuery(
        `SELECT id, organizer, title
         FROM linkedin.profile_courses WHERE profile_id = $1 ORDER BY order_in_profile ASC`,
        [profileId]
      ),
      safeQuery(
        `SELECT id, organization_name, position, description, date_from, date_from_year,
                date_from_month, date_to, date_to_year, date_to_month
         FROM linkedin.profile_organizations WHERE profile_id = $1 ORDER BY order_in_profile ASC`,
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
        date_from_year:    e.date_from_year    ?? undefined,
        date_from_month:   e.date_from_month   ?? undefined,
        date_to:           e.date_to           ?? undefined,
        date_to_year:      e.date_to_year      ?? undefined,
        date_to_month:     e.date_to_month     ?? undefined,
        description:       e.description       ?? undefined,
        active_experience: e.active_experience ?? undefined,
        duration_months:   e.duration_months   ?? undefined,
        department:        e.department        ?? undefined,
        management_level:  e.management_level  ?? undefined,
      })),
      educations: educationsRows.map((e) => ({
        id:                      e.id,
        institution_name:        e.institution_name        ?? undefined,
        institution_logo_url:    e.institution_logo_url    ?? undefined,
        institution_url:         e.institution_url         ?? undefined,
        degree:                  e.degree                  ?? undefined,
        date_from_year:          e.date_from_year          ?? undefined,
        date_to_year:            e.date_to_year            ?? undefined,
        description:             e.description             ?? undefined,
        activities_and_societies: e.activities_and_societies ?? undefined,
      })),
      skills: skillsRows.map((s) => ({
        id:          s.id,
        skill_name:  s.skill_name  ?? undefined,
        is_inferred: s.is_inferred ?? undefined,
      })),
      certifications: certificationsRows.map((c) => ({
        id:                   c.id,
        title:                c.title                ?? undefined,
        issuer:               c.issuer               ?? undefined,
        issuer_url:           c.issuer_url           ?? undefined,
        credential_id:        c.credential_id        ?? undefined,
        certificate_url:      c.certificate_url      ?? undefined,
        certificate_logo_url: c.certificate_logo_url ?? undefined,
        date_from:            c.date_from            ?? undefined,
        date_from_year:       c.date_from_year       ?? undefined,
        date_from_month:      c.date_from_month      ?? undefined,
        date_to:              c.date_to              ?? undefined,
        date_to_year:         c.date_to_year         ?? undefined,
        date_to_month:        c.date_to_month        ?? undefined,
      })),
      awards: awardsRows.map((a) => ({
        id:          a.id,
        award_title: a.award_title ?? undefined,
        issuer:      a.issuer      ?? undefined,
        description: a.description ?? undefined,
        award_date:  a.award_date  ?? undefined,
        date_year:   a.date_year   ?? undefined,
        date_month:  a.date_month  ?? undefined,
      })),
      publications: publicationsRows.map((p) => ({
        id:                p.id,
        title:             p.title             ?? undefined,
        description:       p.description       ?? undefined,
        publication_url:   p.publication_url   ?? undefined,
        publication_names: p.publication_names ?? undefined,
        date:              p.date              ?? undefined,
        date_year:         p.date_year         ?? undefined,
        date_month:        p.date_month        ?? undefined,
      })),
      patents: patentsRows.map((p) => ({
        id:            p.id,
        title:         p.title         ?? undefined,
        description:   p.description   ?? undefined,
        patent_url:    p.patent_url    ?? undefined,
        patent_number: p.patent_number ?? undefined,
        status:        p.status        ?? undefined,
        date:          p.date          ?? undefined,
        date_year:     p.date_year     ?? undefined,
        date_month:    p.date_month    ?? undefined,
      })),
      languages: languagesRows.map((l) => ({
        id:            l.id,
        language_name: l.language_name ?? undefined,
        proficiency:   l.proficiency   ?? undefined,
      })),
      projects: projectsRows.map((p) => ({
        id:              p.id,
        name:            p.name            ?? undefined,
        description:     p.description     ?? undefined,
        project_url:     p.project_url     ?? undefined,
        date_from:       p.date_from       ?? undefined,
        date_from_year:  p.date_from_year  ?? undefined,
        date_from_month: p.date_from_month ?? undefined,
        date_to:         p.date_to         ?? undefined,
        date_to_year:    p.date_to_year    ?? undefined,
        date_to_month:   p.date_to_month   ?? undefined,
      })),
      courses: coursesRows.map((c) => ({
        id:        c.id,
        organizer: c.organizer ?? undefined,
        title:     c.title     ?? undefined,
      })),
      organizations: organizationsRows.map((o) => ({
        id:                o.id,
        organization_name: o.organization_name ?? undefined,
        position:          o.position          ?? undefined,
        description:       o.description       ?? undefined,
        date_from:         o.date_from         ?? undefined,
        date_from_year:    o.date_from_year    ?? undefined,
        date_from_month:   o.date_from_month   ?? undefined,
        date_to:           o.date_to           ?? undefined,
        date_to_year:      o.date_to_year      ?? undefined,
        date_to_month:     o.date_to_month     ?? undefined,
      })),
    });
  } catch (err) {
    req.log.error({ err }, "Profile detail error");
    res.status(500).json({ error: "Failed to fetch profile" });
  }
});

export default router;
