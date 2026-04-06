import { Client } from "@opensearch-project/opensearch";

const OPEN_SEARCH_URL =
  process.env.OPENSEARCH_URL ??
  process.env.OPENSEARCH_NODE_URL ??
  process.env.ELASTICSEARCH_URL ??
  "https://135.235.196.207:9200";

const OPEN_SEARCH_INDEX = process.env.OPENSEARCH_INDEX ?? "profiles";
const OPEN_SEARCH_USERNAME =
  process.env.OPENSEARCH_USERNAME ??
  process.env.OPENSEARCH_USER ??
  "admin";
const OPEN_SEARCH_PASSWORD =
  process.env.OPENSEARCH_PASSWORD ??
  process.env.OPENSEARCH_PASS ??
  "Link3diN$c6ap3rOp3nS3a6ch";
const OPEN_SEARCH_GENDER_BATCH_SIZE = 500;

const osClient = new Client({
  node: OPEN_SEARCH_URL,
  auth: {
    username: OPEN_SEARCH_USERNAME,
    password: OPEN_SEARCH_PASSWORD,
  },
  ssl: {
    rejectUnauthorized: false,
  },
  maxRetries: 1,
  requestTimeout: 300000,
  agent: {
    keepAlive: true,
    maxSockets: 256,
  },
});

type OpenSearchHit = {
  _id: string;
  _score: number | null;
  _source?: {
    profile_id?: number | string;
    id?: number | string;
    public_profile_id?: number | string;
  };
};

type OpenSearchSearchResponse = {
  body?: {
    hits?: {
      total?: {
        value?: number;
        relation?: string;
      };
      max_score?: number | null;
      hits?: OpenSearchHit[];
    };
  };
};

type OpenSearchUpdateByQueryResponse = {
  body?: {
    updated?: number;
  };
};

function chunkItems<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}

export async function searchProfiles(body: Record<string, unknown>) {
  const response = (await osClient.search({
    index: OPEN_SEARCH_INDEX,
    body,
  })) as OpenSearchSearchResponse;

  const total = response.body?.hits?.total?.value ?? 0;
  const maxScore = response.body?.hits?.max_score ?? 0;
  const hits = response.body?.hits?.hits ?? [];

  console.log(
    "OpenSearch raw hit sample:",
    hits.slice(0, 3).map((hit) => ({
      _id: hit._id,
      _score: hit._score,
      _source: hit._source,
    }))
  );

  return {
    total,
    maxScore: maxScore ?? 0,
    hits: hits.map((hit) => ({
      id:
        Number(hit._source?.profile_id) ||
        Number(hit._source?.public_profile_id) ||
        Number(hit._source?.id) ||
        Number(hit._id),
      score: hit._score ?? 0,
    })),
  };
}

export async function updateProfilesGender(
  profileIds: number[],
  gender: "male" | "female"
) {
  if (profileIds.length === 0) {
    return { updated: 0 };
  }

  let updated = 0;

  for (const profileIdBatch of chunkItems(profileIds, OPEN_SEARCH_GENDER_BATCH_SIZE)) {
    const response = (await osClient.updateByQuery({
      index: OPEN_SEARCH_INDEX,
      refresh: true,
      conflicts: "proceed",
      wait_for_completion: true,
      body: {
        script: {
          lang: "painless",
          source: "ctx._source.gender = params.gender",
          params: {
            gender,
          },
        },
        query: {
          bool: {
            should: [
              {
                terms: {
                  profile_id: profileIdBatch,
                },
              },
              {
                terms: {
                  public_profile_id: profileIdBatch,
                },
              },
              {
                terms: {
                  id: profileIdBatch,
                },
              },
            ],
            minimum_should_match: 1,
          },
        },
      },
    })) as OpenSearchUpdateByQueryResponse;

    updated += response.body?.updated ?? 0;
  }

  return { updated };
}
