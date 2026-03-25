export const PAGE_SIZE = 10;
export const EXPORT_BATCH_SIZE = 1000;

export const PROFILE_SEARCH_FIELDS = [
  "headline^10",
  "active_experience_title^10",
  "current_experience^10",
  "summary^8",
  "past_experience^6",
  "skills^4",
] as const;

type SearchQueryParams = {
  skills?: string;
  designation?: string;
  locations?: string[];
  minExperience?: number;
  maxExperience?: number;
  page: number;
  size?: number;
};

function normalizeBooleanInput(value?: string): string | null {
  const trimmed = value?.trim();
  return trimmed ? `(${trimmed})` : null;
}

export function buildProfileSearchQuery({
  skills,
  designation,
  locations,
  minExperience,
  maxExperience,
  page,
  size = PAGE_SIZE,
}: SearchQueryParams) {
  const must: Array<Record<string, unknown>> = [];
  const filter: Array<Record<string, unknown>> = [];

  const booleanParts = [
    normalizeBooleanInput(skills),
    normalizeBooleanInput(designation),
  ].filter((value): value is string => Boolean(value));

  if (booleanParts.length > 0) {
    must.push({
      query_string: {
        query: booleanParts.join(" AND "),
        fields: [...PROFILE_SEARCH_FIELDS],
        default_operator: "AND",
      },
    });
  }

  const normalizedLocations =
    locations?.map((location) => location.trim()).filter(Boolean) ?? [];

  if (normalizedLocations.length === 1) {
    filter.push({
      term: {
        "location_full.keyword": normalizedLocations[0],
      },
    });
  } else if (normalizedLocations.length > 1) {
    filter.push({
      terms: {
        "location_full.keyword": normalizedLocations,
      },
    });
  }

  const experienceRange: Record<string, number> = {};
  if (typeof minExperience === "number" && Number.isFinite(minExperience)) {
    experienceRange.gte = minExperience;
  }
  if (typeof maxExperience === "number" && Number.isFinite(maxExperience)) {
    experienceRange.lte = maxExperience;
  }

  if (Object.keys(experienceRange).length > 0) {
    filter.push({
      range: {
        total_years_exp: experienceRange,
      },
    });
  }

  const from = Math.max(0, (page - 1) * size);

  const query =
    must.length > 0 || filter.length > 0
      ? {
          bool: {
            ...(must.length > 0 ? { must } : {}),
            ...(filter.length > 0 ? { filter } : {}),
          },
        }
      : { match_all: {} };

  return {
    from,
    size,
    track_total_hits: true,
    query,
  };
}

export function normalizeScore(score: number, maxScore: number): number {
  if (!Number.isFinite(score) || !Number.isFinite(maxScore) || maxScore <= 0) {
    return 0;
  }

  return Math.round((score / maxScore) * 10000) / 100;
}
