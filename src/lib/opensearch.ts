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
