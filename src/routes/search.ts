import { Router, type IRouter, type Request, type Response } from "express";
import linkedinPool from "../lib/linkedinDb.js";
import {
  buildTsQuery,
  getSubsetOffset,
  SUBSET_SIZE_CONST,
  PAGE_SIZE_CONST,
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
    const subsets = Math.ceil(total / SUBSET_SIZE_CONST);

    res.json({ total, subsets, subsetSize: SUBSET_SIZE_CONST });
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

  const subsetOffset = getSubsetOffset(subset);           // subset * 1000
  const pageOffset   = (page - 1) * PAGE_SIZE_CONST;     // (page-1) * 20
  const totalPages   = Math.ceil(SUBSET_SIZE_CONST / PAGE_SIZE_CONST); // always 50

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
      -- Step 2: score each profile (LEFT JOIN so profiles with no
      --         experience_text rows are NOT dropped; GROUP BY to
      --         collapse the one-row-per-experience explosion)
      scored AS (
        SELECT
          f.profile_id,
          MAX(
            ts_rank_cd(ps.tsv_headline,                               q.tsq) * 1.0  +
            ts_rank_cd(ps.tsv_active_experience_title,                q.tsq) * 0.9  +
            COALESCE(ts_rank_cd('{0.0,0.0,0.0,1.0}', et.tsv_title,        q.tsq) * 0.8, 0) +
            COALESCE(ts_rank_cd('{0.0,0.0,0.0,1.0}', et.tsv_description,  q.tsq) * 0.8, 0) +
            ts_rank_cd(ps.tsv_summary,                                q.tsq) * 0.5  +
            COALESCE(ts_rank_cd('{0.25,0.5,1.0,0.0}', et.tsv_title,       q.tsq) * 0.4, 0) +
            COALESCE(ts_rank_cd('{0.25,0.5,1.0,0.0}', et.tsv_description, q.tsq) * 0.4, 0) +
            ts_rank_cd(ps.tsv_skill,                                  q.tsq) * 0.2
          ) AS score
        FROM   filtered f
        JOIN   linkedin.profile_search ps  ON ps.profile_id  = f.profile_id
        LEFT   JOIN linkedin.experience_text et ON et.profile_id = f.profile_id
        CROSS  JOIN q
        GROUP  BY f.profile_id
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
      [tsq, SUBSET_SIZE_CONST, subsetOffset, PAGE_SIZE_CONST, pageOffset]
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

    res.json({ profiles, subset, page, totalPages, subsetSize: SUBSET_SIZE_CONST });
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

    const [experiencesResult, educationsResult, skillsResult] =
      await Promise.all([
        linkedinPool.query(
          `
          SELECT
            id, position_title, company_name, company_logo_url, company_industry,
            location, date_from, date_to, description, active_experience, duration_months
          FROM linkedin.profile_experiences
          WHERE profile_id = $1
          ORDER BY order_in_profile ASC
          `,
          [profileId]
        ),
        linkedinPool.query(
          `
          SELECT
            id, institution_name, institution_logo_url, degree, date_from_year, date_to_year
          FROM linkedin.profile_educations
          WHERE profile_id = $1
          ORDER BY order_in_profile ASC
          `,
          [profileId]
        ),
        linkedinPool.query(
          `
          SELECT skill_name
          FROM   linkedin.profile_skills
          WHERE  profile_id = $1
          ORDER BY id ASC
          `,
          [profileId]
        ),
      ]);

    const row = profileResult.rows[0];

    res.json({
      id:                               String(row.id),
      full_name:                        row.full_name                       ?? "",
      headline:                         row.headline                        ?? undefined,
      picture_url:                      row.picture_url                     ?? undefined,
      location_full:                    row.location_full                   ?? undefined,
      location_city:                    row.location_city                   ?? undefined,
      location_country:                 row.location_country                ?? undefined,
      summary:                          row.summary                         ?? undefined,
      linkedin_url:                     row.linkedin_url                    ?? undefined,
      connections_count:                row.connections_count               ?? undefined,
      followers_count:                  row.followers_count                 ?? undefined,
      active_experience_title:          row.active_experience_title         ?? undefined,
      total_experience_duration_months: row.total_experience_duration_months ?? undefined,
      experiences: experiencesResult.rows.map((e) => ({
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
      educations: educationsResult.rows.map((e) => ({
        id:                   e.id,
        institution_name:     e.institution_name     ?? undefined,
        institution_logo_url: e.institution_logo_url ?? undefined,
        degree:               e.degree               ?? undefined,
        date_from_year:       e.date_from_year       ?? undefined,
        date_to_year:         e.date_to_year         ?? undefined,
      })),
      skills: skillsResult.rows.map((s) => ({
        skill_name: s.skill_name ?? undefined,
      })),
    });
  } catch (err) {
    req.log.error({ err }, "Profile detail error");
    res.status(500).json({ error: "Failed to fetch profile" });
  }
});

export default router;
