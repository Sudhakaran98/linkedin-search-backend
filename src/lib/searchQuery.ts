export const PAGE_SIZE = 10;
export const EXPORT_BATCH_SIZE = 1000;
export const SELECT_ALL_FILTER_VALUE = "Select All";

export const PROFILE_SEARCH_FIELDS = [
  "headline^10",
  "active_experience_title^10",
  "current_experience^10",
  "summary^8",
  "past_experience^6",
  "skills^4",
] as const;

const FEMALE_CANDIDATE_NAME_REGEX = ".*[aiy]";

const COMPANY_SIZE_RANGE_MAP: Record<string, { min: number; max?: number }> = {
  "1-10 employees": { min: 1, max: 10 },
  "11-50 employees": { min: 11, max: 50 },
  "51-200 employees": { min: 51, max: 200 },
  "201-500 employees": { min: 201, max: 500 },
  "501-1000 employees": { min: 501, max: 1000 },
  "1001-5000 employees": { min: 1001, max: 5000 },
  "5001-10,000 employees": { min: 5001, max: 10000 },
  "10,001+ employees": { min: 10001 },
};

function isSelectAllFilterValue(value: string): boolean {
  return value.trim().toLowerCase() === SELECT_ALL_FILTER_VALUE.toLowerCase();
}

type SearchQueryParams = {
  skills?: string;
  designation?: string;
  femaleCandidate?: boolean;
  locations?: string[];
  companySizeRanges?: string[];
  companyCategories?: string[];
  companyCategoryScope?: "current" | "past";
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
  femaleCandidate,
  locations,
  companySizeRanges,
  companyCategories,
  companyCategoryScope,
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

  if (femaleCandidate) {
    filter.push({
      bool: {
        should: [
          {
            regexp: {
              "first_name.keyword": FEMALE_CANDIDATE_NAME_REGEX,
            },
          },
          {
            regexp: {
              "full_name.keyword": FEMALE_CANDIDATE_NAME_REGEX,
            },
          },
        ],
        minimum_should_match: 1,
      },
    });
  }

  const selectedCompanySizeRanges =
    companySizeRanges
      ?.map((range) => COMPANY_SIZE_RANGE_MAP[range])
      .filter((range): range is { min: number; max?: number } => Boolean(range)) ?? [];

  const selectedCompanyCategories =
    companyCategories
      ?.map((category) => category.trim())
      .filter((category) => Boolean(category) && !isSelectAllFilterValue(category)) ?? [];

  if (selectedCompanySizeRanges.length > 0) {
    filter.push({
      nested: {
        path: "experiences",
        query: {
          bool: {
            filter: [
              {
                term: {
                  "experiences.order_in_profile": 1,
                },
              },
              {
                bool: {
                  should: selectedCompanySizeRanges.map((range) => {
                    const rangeFilters: Array<Record<string, unknown>> = [
                      {
                        range: {
                          "experiences.company_size_max": {
                            gte: range.min,
                          },
                        },
                      },
                    ];

                    if (typeof range.max === "number") {
                      rangeFilters.push({
                        range: {
                          "experiences.company_size_min": {
                            lte: range.max,
                          },
                        },
                      });
                    }

                    return {
                      bool: {
                        filter: rangeFilters,
                      },
                    };
                  }),
                  minimum_should_match: 1,
                },
              },
            ],
          },
        },
      },
    });
  }

  if (selectedCompanyCategories.length > 0) {
    const companyCategoryScopeFilter =
      companyCategoryScope === "past"
        ? {
            range: {
              "experiences.order_in_profile": {
                gt: 1,
              },
            },
          }
        : {
            term: {
              "experiences.order_in_profile": 1,
            },
          };

    filter.push({
      nested: {
        path: "experiences",
        query: {
          bool: {
            filter: [
              companyCategoryScopeFilter,
              {
                terms: {
                  "experiences.company_categories_and_keywords": selectedCompanyCategories,
                },
              },
            ],
          },
        },
      },
    });
  }

  const normalizedLocations =
    locations
      ?.map((location) => location.trim())
      .filter((location) => Boolean(location) && !isSelectAllFilterValue(location)) ?? [];

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
