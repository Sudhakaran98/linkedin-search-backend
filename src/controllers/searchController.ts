import { type Request, type Response } from "express";
import { type PoolClient } from "pg";
import linkedinPool from "../lib/db.js";
import { searchProfiles, updateProfilesGender } from "../lib/opensearch.js";
import {
  buildProfileSearchQuery,
  EXPORT_BATCH_SIZE,
  normalizeScore,
  PAGE_SIZE,
  SELECT_ALL_FILTER_VALUE,
  SUPPORTED_GENDERS,
} from "../lib/searchQuery.js";

const LOCATION_PAGE_SIZE = 50;
const COMPANY_CATEGORY_PAGE_SIZE = 50;
const EXPORT_PG_BATCH_SIZE = 1000;

function isSelectAllFilterValue(value: string): boolean {
  return value.trim().toLowerCase() === SELECT_ALL_FILTER_VALUE.toLowerCase();
}

function normalizeGenderValue(
  value: unknown
): (typeof SUPPORTED_GENDERS)[number] | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  return SUPPORTED_GENDERS.find((gender) => gender === normalized);
}

type SearchInputs = {
  skills?: string;
  designation?: string;
  femaleCandidate?: boolean;
  gender?: (typeof SUPPORTED_GENDERS)[number];
  locations?: string[];
  companySizeRanges?: string[];
  companyCategories?: string[];
  companyCategoryScope?: "current" | "past";
  minExperience?: number;
  maxExperience?: number;
  page: number;
};

function parsePage(rawPage: unknown): number {
  return Math.max(1, parseInt(String(rawPage ?? "1"), 10) || 1);
}

function parseExperienceValue(rawYears: unknown): number | undefined {
  if (rawYears === undefined || rawYears === null || rawYears === "") {
    return undefined;
  }

  const parsed = parseInt(String(rawYears), 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseBooleanValue(rawValue: unknown): boolean {
  if (typeof rawValue === "boolean") {
    return rawValue;
  }

  if (typeof rawValue === "string") {
    const normalized = rawValue.trim().toLowerCase();
    return normalized === "true" || normalized === "1" || normalized === "yes";
  }

  return false;
}

function normalizeLocations(rawLocation: unknown): string[] {
  if (Array.isArray(rawLocation)) {
    return rawLocation
      .map((location) => String(location ?? "").trim())
      .filter((location) => Boolean(location) && !isSelectAllFilterValue(location));
  }

  if (typeof rawLocation === "string") {
    const trimmed = rawLocation.trim();
    return trimmed && !isSelectAllFilterValue(trimmed) ? [trimmed] : [];
  }

  return [];
}

function normalizeStringArray(rawValue: unknown): string[] {
  if (Array.isArray(rawValue)) {
    return rawValue
      .map((value) => String(value ?? "").trim())
      .filter((value) => Boolean(value) && !isSelectAllFilterValue(value));
  }

  if (typeof rawValue === "string") {
    const trimmed = rawValue.trim();
    return trimmed && !isSelectAllFilterValue(trimmed) ? [trimmed] : [];
  }

  return [];
}

function normalizeBooleanFilterText(value?: string): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed.toUpperCase() : undefined;
}

function normalizeCompanyCategoryScope(value: unknown): "current" | "past" {
  if (typeof value !== "string") {
    return "current";
  }

  return value.trim().toLowerCase() === "past" ? "past" : "current";
}

function getSearchInputs(req: Request): SearchInputs {
  const {
    skills,
    designation,
    female_candidate,
    gender,
    location,
    company_size_ranges,
    company_categories,
    company_category_scope,
    min_experience,
    max_experience,
    page,
  } = req.body as {
    skills?: string;
    designation?: string;
    female_candidate?: string | boolean;
    gender?: string;
    location?: string | string[];
    company_size_ranges?: string | string[];
    company_categories?: string | string[];
    company_category_scope?: string;
    min_experience?: string | number;
    max_experience?: string | number;
    page?: string | number;
  };

  const minExperience = parseExperienceValue(min_experience);
  const maxExperience = parseExperienceValue(max_experience);

  return {
    skills: normalizeBooleanFilterText(skills),
    designation: normalizeBooleanFilterText(designation),
    femaleCandidate: parseBooleanValue(female_candidate),
    gender: normalizeGenderValue(gender),
    locations: normalizeLocations(location),
    companySizeRanges: normalizeStringArray(company_size_ranges),
    companyCategories: normalizeStringArray(company_categories),
    companyCategoryScope: normalizeCompanyCategoryScope(company_category_scope),
    minExperience:
      minExperience !== undefined && maxExperience !== undefined
        ? Math.min(minExperience, maxExperience)
        : minExperience,
    maxExperience:
      minExperience !== undefined && maxExperience !== undefined
        ? Math.max(minExperience, maxExperience)
        : maxExperience,
    page: parsePage(page),
  };
}

async function fetchProfilesByIds(profileIds: number[]) {
  if (profileIds.length === 0) {
    return [];
  }

  const [profilesResult, experiencesResult] = await Promise.all([
    linkedinPool.query(
      `
      SELECT
        p.id,
        p.full_name,
        p.gender,
        p.headline,
        p.summary,
        p.picture_url,
        p.location_full,
        p.location_city,
        p.location_country,
        p.linkedin_url
      FROM linkedin.profiles p
      WHERE p.id = ANY($1::bigint[])
      `,
      [profileIds]
    ),
    linkedinPool.query(
      `
      SELECT
        e.profile_id AS id,
        e.position_title,
        e.company_name,
        e.company_logo_url,
        e.active_experience,
        e.order_in_profile,
        e.date_from_year,
        e.date_from_month,
        e.date_to_year,
        e.date_to_month
      FROM linkedin.profile_experiences e
      WHERE e.profile_id = ANY($1::bigint[])
      ORDER BY e.profile_id ASC, e.order_in_profile ASC
      `,
      [profileIds]
    ),
  ]);

  const experiencesById = new Map<number, ExperienceDateRow[]>();
  for (const row of experiencesResult.rows) {
    const id = Number(row.id);
    if (!Number.isFinite(id)) {
      continue;
    }

    const experienceRows = experiencesById.get(id) ?? [];
    experienceRows.push(row);
    experiencesById.set(id, experienceRows);
  }

  return profilesResult.rows.map((row) => ({
    ...row,
    ...getExperienceSummaryFromRows(experiencesById.get(Number(row.id)) ?? []),
  }));
}

function mapListProfiles(openSearchResult: Awaited<ReturnType<typeof searchProfiles>>, hydratedRows: any[]) {
  const rowById = new Map(hydratedRows.map((row) => [Number(row.id), row]));

  return openSearchResult.hits
    .map((hit) => {
      const row = rowById.get(hit.id);
      if (!row) {
        return null;
      }

      return {
        id: String(row.id),
        full_name: row.full_name ?? "",
        gender: row.gender ?? undefined,
        headline: row.headline ?? undefined,
        picture_url: row.picture_url ?? undefined,
        picture_proxy_url: row.picture_url
          ? `/api/search/profile-image?url=${encodeURIComponent(row.picture_url)}`
          : undefined,
        location_full: row.location_full ?? undefined,
        location_city: row.location_city ?? undefined,
        location_country: row.location_country ?? undefined,
        active_experience_title: row.active_experience_title ?? undefined,
        active_experience_company_name: row.active_experience_company_name ?? undefined,
        active_experience_company_logo_url:
          row.active_experience_company_logo_url ?? undefined,
        current_experience_label: row.current_experience_label ?? undefined,
        past_experience_labels: row.past_experience_labels ?? [],
        summary: row.summary ?? undefined,
        total_experience_duration_months:
          row.total_experience_duration_months ?? undefined,
        linkedin_url: row.linkedin_url ?? undefined,
        score: {
          raw: hit.score,
          normalized: normalizeScore(hit.score, openSearchResult.maxScore),
        },
      };
    })
    .filter((profile): profile is NonNullable<typeof profile> => Boolean(profile));
}

function escapeCsvCell(value: unknown): string {
  const normalized = String(value ?? "").replace(/"/g, '""');
  return `"${normalized}"`;
}

function formatDuration(months?: number | null): string {
  if (!months || months <= 0) {
    return "";
  }

  const years = Math.floor(months / 12);
  const remainingMonths = months % 12;

  if (years > 0 && remainingMonths > 0) {
    return `${years} yr ${remainingMonths} mo`;
  }
  if (years > 0) {
    return `${years} yr`;
  }
  return `${remainingMonths} mo`;
}

function formatCurrentExperience(row: {
  active_experience_title?: string | null;
  active_experience_company_name?: string | null;
}) {
  return [row.active_experience_title, row.active_experience_company_name]
    .filter(Boolean)
    .join(" at ");
}

function chunkArray<T>(items: T[], chunkSize: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }
  return chunks;
}

type ExperienceDateRow = {
  active_experience?: boolean | null;
  order_in_profile?: number | null;
  position_title?: string | null;
  company_name?: string | null;
  date_from_year?: string | number | null;
  date_from_month?: string | number | null;
  date_to_year?: string | number | null;
  date_to_month?: string | number | null;
};

function parseNullableInt(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  const parsed = parseInt(String(value), 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function clampMonth(value: number | undefined, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.min(12, Math.max(1, value));
}

function calculateExperienceDurationMonths(experiences: ExperienceDateRow[]): number | undefined {
  const currentDate = new Date();
  const currentYear = currentDate.getFullYear();
  const currentMonth = currentDate.getMonth() + 1;

  let earliest: { year: number; month: number } | null = null;
  let latest: { year: number; month: number } | null = null;

  for (const experience of experiences) {
    const startYear = parseNullableInt(experience.date_from_year);
    if (startYear === undefined) {
      continue;
    }

    const startMonth = clampMonth(parseNullableInt(experience.date_from_month), 1);
    const endYear = parseNullableInt(experience.date_to_year) ?? currentYear;
    const endMonth = clampMonth(
      parseNullableInt(experience.date_to_month),
      endYear === currentYear ? currentMonth : 12
    );

    if (
      !earliest ||
      startYear < earliest.year ||
      (startYear === earliest.year && startMonth < earliest.month)
    ) {
      earliest = { year: startYear, month: startMonth };
    }

    if (
      !latest ||
      endYear > latest.year ||
      (endYear === latest.year && endMonth > latest.month)
    ) {
      latest = { year: endYear, month: endMonth };
    }
  }

  if (!earliest || !latest) {
    return undefined;
  }

  return Math.max(0, (latest.year - earliest.year) * 12 + (latest.month - earliest.month));
}

function getCurrentExperienceFromRows(experiences: ExperienceDateRow[]) {
  const currentExperience =
    experiences.find(
      (experience) => experience.active_experience === true && experience.order_in_profile === 1
    ) ?? experiences[0];

  return {
    active_experience_title: currentExperience?.position_title ?? undefined,
    active_experience_company_name: currentExperience?.company_name ?? undefined,
  };
}

function formatExperienceLabel(experience: ExperienceDateRow): string {
  const title = String(experience.position_title ?? "").trim();
  const company = String(experience.company_name ?? "").trim();

  if (title && company) {
    return `${title} at ${company}`;
  }

  return title || company;
}

function getExperienceSummaryFromRows(experiences: ExperienceDateRow[]) {
  const currentExperience =
    experiences.find(
      (experience) => experience.active_experience === true && experience.order_in_profile === 1
    ) ?? experiences[0];

  const currentExperienceLabel = currentExperience
    ? formatExperienceLabel(currentExperience)
    : undefined;

  const pastExperienceLabels = experiences
    .filter((experience) => experience !== currentExperience)
    .map(formatExperienceLabel)
    .filter((label) => Boolean(label));

  return {
    active_experience_title: currentExperience?.position_title ?? undefined,
    active_experience_company_name: currentExperience?.company_name ?? undefined,
    current_experience_label: currentExperienceLabel,
    past_experience_labels: pastExperienceLabels,
    total_experience_duration_months: calculateExperienceDurationMonths(experiences),
  };
}

async function searchAllProfileIds(inputs: SearchInputs) {
  const profileIds: number[] = [];
  let page = 1;
  const resolvedInputs = await resolveCompanyDomainInputs(inputs);

  while (true) {
    const searchBody = buildProfileSearchQuery({
      ...resolvedInputs,
      page,
      size: EXPORT_BATCH_SIZE,
    });

    const openSearchResult = await searchProfiles(searchBody);
    const batchIds = openSearchResult.hits
      .map((hit) => hit.id)
      .filter((id) => Number.isFinite(id));

    profileIds.push(...batchIds);

    if (batchIds.length < EXPORT_BATCH_SIZE || profileIds.length >= openSearchResult.total) {
      break;
    }

    page += 1;
  }

  return profileIds;
}

async function resolveCompanyDomainInputs(inputs: SearchInputs): Promise<SearchInputs> {
  if (!inputs.companyCategories || inputs.companyCategories.length === 0) {
    return inputs;
  }

  const selectedDomains = Array.from(
    new Set(
      inputs.companyCategories
        .map((domain) => String(domain ?? "").trim())
        .filter(Boolean)
    )
  );

  if (selectedDomains.length === 0) {
    return {
      ...inputs,
      companyCategories: [],
    };
  }

  const categoriesResult = await linkedinPool.query<{ category: string }>(
    `
    SELECT DISTINCT btrim(category) AS category
    FROM linkedin.companies c
    CROSS JOIN LATERAL unnest(COALESCE(c.company_categories_and_keywords, ARRAY[]::text[])) AS category
    WHERE COALESCE(c.company_domains, ARRAY[]::text[]) && $1::text[]
      AND category IS NOT NULL
      AND btrim(category) <> ''
    `,
    [selectedDomains]
  );

  return {
    ...inputs,
    companyCategories: categoriesResult.rows.map((row) => row.category),
  };
}

async function fetchExportProfilesByIds(profileIds: number[]) {
  if (profileIds.length === 0) {
    return [];
  }

  const profilesById = new Map<
    number,
    {
      id: number;
      full_name?: string | null;
      headline?: string | null;
      location_full?: string | null;
      linkedin_url?: string | null;
      summary?: string | null;
      active_experience_title?: string | null;
      active_experience_company_name?: string | null;
      total_experience_duration_months?: number | null;
      skills: Set<string>;
    }
  >();
  const experiencesById = new Map<number, ExperienceDateRow[]>();

  const batches = chunkArray(profileIds, EXPORT_PG_BATCH_SIZE);

  for (const batchProfileIds of batches) {
    const [profilesResult, experiencesResult] = await Promise.all([
      linkedinPool.query(
        `
        SELECT
          p.id,
          p.full_name,
          p.headline,
          p.location_full,
          p.linkedin_url,
          p.summary,
          s.skill_name
        FROM linkedin.profiles p
        LEFT JOIN linkedin.profile_skills s
          ON s.profile_id = p.id
         AND s.skill_name IS NOT NULL
        WHERE p.id = ANY($1::bigint[])
        `,
        [batchProfileIds]
      ),
      linkedinPool.query(
        `
        SELECT
          e.profile_id AS id,
          e.position_title,
          e.company_name,
          e.active_experience,
          e.order_in_profile,
          e.date_from_year,
          e.date_from_month,
          e.date_to_year,
          e.date_to_month
        FROM linkedin.profile_experiences e
        WHERE e.profile_id = ANY($1::bigint[])
        ORDER BY e.profile_id ASC, e.order_in_profile ASC
        `,
        [batchProfileIds]
      ),
    ]);

    for (const row of profilesResult.rows) {
      const id = Number(row.id);
      if (!Number.isFinite(id)) {
        continue;
      }

      let profile = profilesById.get(id);
      if (!profile) {
        profile = {
          id,
          full_name: row.full_name ?? null,
          headline: row.headline ?? null,
          location_full: row.location_full ?? null,
          linkedin_url: row.linkedin_url ?? null,
          summary: row.summary ?? null,
          active_experience_title: undefined,
          active_experience_company_name: undefined,
          total_experience_duration_months: undefined,
          skills: new Set<string>(),
        };
        profilesById.set(id, profile);
      }

      if (!profile.full_name && row.full_name != null) profile.full_name = row.full_name;
      if (!profile.headline && row.headline != null) profile.headline = row.headline;
      if (!profile.location_full && row.location_full != null) profile.location_full = row.location_full;
      if (!profile.linkedin_url && row.linkedin_url != null) profile.linkedin_url = row.linkedin_url;
      if (!profile.summary && row.summary != null) profile.summary = row.summary;

      const skillName = String(row.skill_name ?? "").trim();
      if (skillName) {
        profile.skills.add(skillName);
      }
    }

    for (const row of experiencesResult.rows) {
      const id = Number(row.id);
      if (!Number.isFinite(id)) {
        continue;
      }

      const experienceRows = experiencesById.get(id) ?? [];
      experienceRows.push(row);
      experiencesById.set(id, experienceRows);
    }
  }

  const aggregated = Array.from(profilesById.values()).map((profile) => {
    const profileExperiences = experiencesById.get(profile.id) ?? [];
    const currentExperience = getCurrentExperienceFromRows(profileExperiences);

    return {
      ...profile,
      ...currentExperience,
      total_experience_duration_months: calculateExperienceDurationMonths(profileExperiences),
      skills: Array.from(profile.skills).sort((a, b) => a.localeCompare(b)).join(" | "),
    };
  });

  return aggregated;
}

export async function listProfiles(req: Request, res: Response) {
  try {
    const inputs = await resolveCompanyDomainInputs(getSearchInputs(req));
    const searchBody = buildProfileSearchQuery(inputs);

    const openSearchResult = await searchProfiles(searchBody);
    const totalPages =
      openSearchResult.total > 0 ? Math.ceil(openSearchResult.total / PAGE_SIZE) : 0;

    const profileIds = openSearchResult.hits
      .map((hit) => hit.id)
      .filter((id) => Number.isFinite(id));

    const hydratedRows = await fetchProfilesByIds(profileIds);
    const profiles = mapListProfiles(openSearchResult, hydratedRows);

    res.json({
      profiles,
      total: openSearchResult.total,
      page: inputs.page,
      totalPages,
      pageSize: PAGE_SIZE,
      maxScore: {
        raw: openSearchResult.maxScore,
        normalized: openSearchResult.maxScore > 0 ? 100 : 0,
      },
    });
  } catch (err) {
    req.log.error({ err }, "List profiles error");
    res.status(500).json({ error: "Search failed" });
  }
}

export async function downloadProfilesCsv(req: Request, res: Response) {
  try {
    const inputs = await resolveCompanyDomainInputs(getSearchInputs(req));

    const profileIds = await searchAllProfileIds(inputs);
    const rows = await fetchExportProfilesByIds(profileIds);
    const rowById = new Map(rows.map((row) => [Number(row.id), row]));

    const header = [
      "profile_id",
      "full_name",
      "headline",
      "location_full",
      "total_experience",
      "current_experience",
      "linkedin_url",
      "summary",
      "skills",
    ];

    const csvRows = profileIds
      .map((profileId) => {
        const row = rowById.get(profileId);
        if (!row) {
          return null;
        }

        return [
          profileId,
          row.full_name ?? "",
          row.headline ?? "",
          row.location_full ?? "",
          formatDuration(row.total_experience_duration_months),
          formatCurrentExperience(row),
          row.linkedin_url ?? "",
          row.summary ?? "",
          row.skills ?? "",
        ]
          .map(escapeCsvCell)
          .join(",");
      })
      .filter((row): row is string => Boolean(row));

    const csv = [header.join(","), ...csvRows].join("\n");

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="profiles-export.csv"'
    );
    res.send(csv);
  } catch (err) {
    req.log.error({ err }, "Download profiles error");
    res.status(500).json({ error: "Failed to export profiles" });
  }
}

export async function proxyProfileImage(req: Request, res: Response) {
  const rawUrl = String(req.query.url ?? "");

  if (!rawUrl) {
    res.status(400).json({ error: "Missing image url" });
    return;
  }

  try {
    const parsed = new URL(rawUrl);
    const response = await fetch(parsed, {
      headers: {
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
        referer: "https://www.linkedin.com/",
      },
    });

    if (!response.ok || !response.body) {
      res.status(response.status || 502).end();
      return;
    }

    const contentType = response.headers.get("content-type");
    if (contentType) {
      res.setHeader("Content-Type", contentType);
    }
    res.setHeader("Cache-Control", "public, max-age=86400");

    const arrayBuffer = await response.arrayBuffer();
    res.send(Buffer.from(arrayBuffer));
  } catch (err) {
    req.log.error({ err }, "Proxy profile image error");
    res.status(500).json({ error: "Failed to fetch image" });
  }
}

export async function updateGender(req: Request, res: Response) {
  const fullName = String(req.body?.fullName ?? "").trim();
  const gender = normalizeGenderValue(req.body?.gender);

  if (!fullName) {
    res.status(400).json({ error: "fullName is required" });
    return;
  }

  if (!gender) {
    res.status(400).json({ error: "gender must be male or female" });
    return;
  }

  let client: PoolClient | undefined;

  try {
    client = await linkedinPool.connect();
    await client.query("BEGIN");

    const updateResult = await client.query<{ id: string }>(
      `
      UPDATE linkedin.profiles
      SET gender = $2
      WHERE full_name = $1
      RETURNING id::text AS id
      `,
      [fullName, gender]
    );

    const matchedProfiles = updateResult.rows.length;
    const matchedProfileIds = updateResult.rows
      .map((row) => Number(row.id))
      .filter((id) => Number.isFinite(id));

    if (matchedProfiles === 0) {
      await client.query("ROLLBACK");
      res.status(404).json({ error: "No profiles found for this full name" });
      return;
    }

    const openSearchSync =
      matchedProfileIds.length > 0
        ? await updateProfilesGender(matchedProfileIds, gender)
        : { updated: 0 };

    await client.query("COMMIT");

    res.json({
      fullName,
      gender,
      matchedProfiles,
      openSearchUpdated: openSearchSync.updated,
    });
  } catch (err) {
    if (client) {
      await client.query("ROLLBACK").catch(() => undefined);
    }

    req.log.error({ err, fullName, gender }, "Update gender error");
    res.status(500).json({ error: "Failed to update gender" });
  } finally {
    client?.release();
  }
}

export async function getProfileDetails(req: Request, res: Response) {
  const { profileId } = req.params;

  try {
    const profileResult = await linkedinPool.query(
      `
      SELECT
        p.id, p.full_name, p.headline, p.picture_url,
        p.location_full, p.location_city, p.location_country,
        p.summary, p.linkedin_url, p.activity,
        p.connections_count, p.followers_count
      FROM linkedin.profiles p
      WHERE p.id = $1
      `,
      [profileId]
    );

    if (profileResult.rows.length === 0) {
      res.status(404).json({ error: "Profile not found" });
      return;
    }

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
                department, management_level, order_in_profile
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
      const currentExperience = getCurrentExperienceFromRows(experiencesRows as ExperienceDateRow[]);
      const totalExperienceDurationMonths = calculateExperienceDurationMonths(
        experiencesRows as ExperienceDateRow[]
      );

    res.json({
      id: String(row.id),
      full_name: row.full_name ?? "",
      headline: row.headline ?? undefined,
      picture_url: row.picture_url ?? undefined,
      picture_proxy_url: row.picture_url
        ? `/api/search/profile-image?url=${encodeURIComponent(row.picture_url)}`
        : undefined,
      location_full: row.location_full ?? undefined,
      location_city: row.location_city ?? undefined,
      location_country: row.location_country ?? undefined,
      summary: row.summary ?? undefined,
      activity: row.activity ?? undefined,
      linkedin_url: row.linkedin_url ?? undefined,
      connections_count: row.connections_count ?? undefined,
      followers_count: row.followers_count ?? undefined,
      active_experience_title: currentExperience.active_experience_title,
      active_experience_company_name: currentExperience.active_experience_company_name,
      total_experience_duration_months: totalExperienceDurationMonths,
      experiences: experiencesRows.map((e) => ({
        id: e.id,
        position_title: e.position_title ?? undefined,
        company_name: e.company_name ?? undefined,
        company_logo_url: e.company_logo_url ?? undefined,
        company_industry: e.company_industry ?? undefined,
        location: e.location ?? undefined,
        date_from: e.date_from ?? undefined,
        date_from_year: e.date_from_year ?? undefined,
        date_from_month: e.date_from_month ?? undefined,
        date_to: e.date_to ?? undefined,
        date_to_year: e.date_to_year ?? undefined,
        date_to_month: e.date_to_month ?? undefined,
        description: e.description ?? undefined,
        active_experience: e.active_experience ?? undefined,
        duration_months: e.duration_months ?? undefined,
        department: e.department ?? undefined,
        management_level: e.management_level ?? undefined,
      })),
      educations: educationsRows.map((e) => ({
        id: e.id,
        institution_name: e.institution_name ?? undefined,
        institution_logo_url: e.institution_logo_url ?? undefined,
        institution_url: e.institution_url ?? undefined,
        degree: e.degree ?? undefined,
        date_from_year: e.date_from_year ?? undefined,
        date_to_year: e.date_to_year ?? undefined,
        description: e.description ?? undefined,
        activities_and_societies: e.activities_and_societies ?? undefined,
      })),
      skills: skillsRows.map((s) => ({
        id: s.id,
        skill_name: s.skill_name ?? undefined,
        is_inferred: s.is_inferred ?? undefined,
      })),
      certifications: certificationsRows.map((c) => ({
        id: c.id,
        title: c.title ?? undefined,
        issuer: c.issuer ?? undefined,
        issuer_url: c.issuer_url ?? undefined,
        credential_id: c.credential_id ?? undefined,
        certificate_url: c.certificate_url ?? undefined,
        certificate_logo_url: c.certificate_logo_url ?? undefined,
        date_from: c.date_from ?? undefined,
        date_from_year: c.date_from_year ?? undefined,
        date_from_month: c.date_from_month ?? undefined,
        date_to: c.date_to ?? undefined,
        date_to_year: c.date_to_year ?? undefined,
        date_to_month: c.date_to_month ?? undefined,
      })),
      awards: awardsRows.map((a) => ({
        id: a.id,
        award_title: a.award_title ?? undefined,
        issuer: a.issuer ?? undefined,
        description: a.description ?? undefined,
        award_date: a.award_date ?? undefined,
        date_year: a.date_year ?? undefined,
        date_month: a.date_month ?? undefined,
      })),
      publications: publicationsRows.map((p) => ({
        id: p.id,
        title: p.title ?? undefined,
        description: p.description ?? undefined,
        publication_url: p.publication_url ?? undefined,
        publication_names: p.publication_names ?? undefined,
        date: p.date ?? undefined,
        date_year: p.date_year ?? undefined,
        date_month: p.date_month ?? undefined,
      })),
      patents: patentsRows.map((p) => ({
        id: p.id,
        title: p.title ?? undefined,
        description: p.description ?? undefined,
        patent_url: p.patent_url ?? undefined,
        patent_number: p.patent_number ?? undefined,
        status: p.status ?? undefined,
        date: p.date ?? undefined,
        date_year: p.date_year ?? undefined,
        date_month: p.date_month ?? undefined,
      })),
      languages: languagesRows.map((l) => ({
        id: l.id,
        language_name: l.language_name ?? undefined,
        proficiency: l.proficiency ?? undefined,
      })),
      projects: projectsRows.map((p) => ({
        id: p.id,
        name: p.name ?? undefined,
        description: p.description ?? undefined,
        project_url: p.project_url ?? undefined,
        date_from: p.date_from ?? undefined,
        date_from_year: p.date_from_year ?? undefined,
        date_from_month: p.date_from_month ?? undefined,
        date_to: p.date_to ?? undefined,
        date_to_year: p.date_to_year ?? undefined,
        date_to_month: p.date_to_month ?? undefined,
      })),
      courses: coursesRows.map((c) => ({
        id: c.id,
        organizer: c.organizer ?? undefined,
        title: c.title ?? undefined,
      })),
      organizations: organizationsRows.map((o) => ({
        id: o.id,
        organization_name: o.organization_name ?? undefined,
        position: o.position ?? undefined,
        description: o.description ?? undefined,
        date_from: o.date_from ?? undefined,
        date_from_year: o.date_from_year ?? undefined,
        date_from_month: o.date_from_month ?? undefined,
        date_to: o.date_to ?? undefined,
        date_to_year: o.date_to_year ?? undefined,
        date_to_month: o.date_to_month ?? undefined,
      })),
    });
  } catch (err) {
    req.log.error({ err }, "Profile detail error");
    res.status(500).json({ error: "Failed to fetch profile" });
  }
}

export async function listLocations(req: Request, res: Response) {
  const page = parsePage(req.query.page);
  const offset = (page - 1) * LOCATION_PAGE_SIZE;
  const search = String(req.query.search ?? "").trim();
  const searchPattern = `%${search}%`;

  try {
    const [countResult, locationsResult] = await Promise.all([
      linkedinPool.query<{ total: string }>(
        `
        SELECT COUNT(*)::text AS total
        FROM linkedin.locations l
        WHERE l.location_name IS NOT NULL
          AND btrim(l.location_name) <> ''
          AND ($1 = '%%' OR l.location_name ILIKE $1)
        `,
        [searchPattern]
      ),
      linkedinPool.query<{ id: string; location: string }>(
        `
        SELECT l.id::text AS id, l.location_name AS location
        FROM linkedin.locations l
        WHERE l.location_name IS NOT NULL
          AND btrim(l.location_name) <> ''
          AND ($3 = '%%' OR l.location_name ILIKE $3)
        ORDER BY l.location_name ASC
        LIMIT $1 OFFSET $2
        `,
        [LOCATION_PAGE_SIZE, offset, searchPattern]
      ),
    ]);

    const total = Number(countResult.rows[0]?.total ?? 0);
    const totalPages = total > 0 ? Math.ceil(total / LOCATION_PAGE_SIZE) : 0;

    res.json({
      locations: locationsResult.rows.map((row) => row.location),
      total,
      page,
      totalPages,
      pageSize: LOCATION_PAGE_SIZE,
    });
  } catch (err) {
    req.log.error({ err }, "List locations error");
    res.status(500).json({ error: "Failed to fetch locations" });
  }
}

export async function listCompanyCategories(req: Request, res: Response) {
  const page = parsePage(req.query.page);
  const offset = (page - 1) * COMPANY_CATEGORY_PAGE_SIZE;
  const search = String(req.query.search ?? "").trim();
  const searchPattern = `%${search}%`;

  try {
    const [countResult, categoriesResult] = await Promise.all([
      linkedinPool.query<{ total: string }>(
        `
        WITH domains AS (
          SELECT DISTINCT btrim(domain) AS domain
          FROM linkedin.companies c
          CROSS JOIN LATERAL unnest(COALESCE(c.company_domains, ARRAY[]::text[])) AS domain
          WHERE domain IS NOT NULL
            AND btrim(domain) <> ''
            AND ($1 = '%%' OR btrim(domain) ILIKE $1)
        )
        SELECT COUNT(*)::text AS total
        FROM domains
        `,
        [searchPattern]
      ),
      linkedinPool.query<{ domain: string }>(
        `
        WITH domains AS (
          SELECT DISTINCT btrim(domain) AS domain
          FROM linkedin.companies c
          CROSS JOIN LATERAL unnest(COALESCE(c.company_domains, ARRAY[]::text[])) AS domain
          WHERE domain IS NOT NULL
            AND btrim(domain) <> ''
            AND ($3 = '%%' OR btrim(domain) ILIKE $3)
        )
        SELECT domain
        FROM domains
        ORDER BY domain ASC
        LIMIT $1 OFFSET $2
        `,
        [COMPANY_CATEGORY_PAGE_SIZE, offset, searchPattern]
      ),
    ]);

    const total = Number(countResult.rows[0]?.total ?? 0);
    const totalPages = total > 0 ? Math.ceil(total / COMPANY_CATEGORY_PAGE_SIZE) : 0;
    const companyCategories = categoriesResult.rows.map((row) => row.domain);

    res.json({
      companyCategories:
        page === 1 ? [SELECT_ALL_FILTER_VALUE, ...companyCategories] : companyCategories,
      total,
      page,
      totalPages,
      pageSize: COMPANY_CATEGORY_PAGE_SIZE,
    });
  } catch (err) {
    req.log.error({ err }, "List company categories error");
    res.status(500).json({ error: "Failed to fetch company categories" });
  }
}
