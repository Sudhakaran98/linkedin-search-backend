# LinkedIn Profile Search - Backend

Standalone Node.js + Express API that uses OpenSearch for filtering, ranking, count, and pagination, then hydrates full profile data from PostgreSQL.

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 18+ |
| Framework | Express 5 |
| Language | TypeScript |
| Search | OpenSearch |
| Database | PostgreSQL via `pg` |
| Logging | Pino |

## Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/healthz` | Health check |
| `POST` | `/api/search/profiles` | Ranked profiles with pagination |
| `GET` | `/api/search/profile/:id` | Full profile detail |
| `GET` | `/api/search/locations` | Distinct locations from PostgreSQL with pagination |

### Request body - `/api/search/profiles`

| Param | Type | Description |
|---|---|---|
| `skills` | string | Boolean search string used in OpenSearch |
| `designation` | string | Boolean search string used in OpenSearch |
| `location` | string | Exact match filter on `location_full.keyword` |
| `years_of_experience` | number | Exact match filter on `total_years_exp` |
| `page` | number | 1-indexed page, 20 profiles per page |

### Query parameters - `/api/search/locations`

| Param | Type | Description |
|---|---|---|
| `page` | number | 1-indexed page, 50 locations per page |

## Search Query Syntax

`skills` and `designation` are passed through as boolean query text. If both are present, the backend combines them as:

```text
(skills) AND (designation)
```

Examples:

| Input | Behaviour |
|---|---|
| `java AND spring` | Both terms required |
| `java AND (sql OR mongo OR postgres OR AWS)` | Mixed boolean query |
| `software AND engineer` | Both designation terms required |

## Score Normalization

OpenSearch `_score` is returned as raw score and also normalized to a 0-100 scale.

- `maxScore.normalized` is always `100` when there are hits
- each profile score is `(_score / max_score) * 100`

## Prerequisites

- Node.js >= 18
- Access to PostgreSQL
- Access to OpenSearch

## Installation and Run

```bash
git clone https://github.com/Sudhakaran98/linkedin-search-backend.git
cd linkedin-search-backend
npm install
```

Create `.env`:

```env
PORT=8080

DB_HOST=linkedin-scraper.postgres.database.azure.com
DB_PORT=5432
DB_NAME=postgres
DB_USER=linkedin_scraper
DB_PASSWORD=your_actual_password_here

OPENSEARCH_URL=http://localhost:9200
OPENSEARCH_INDEX=profiles
OPENSEARCH_USERNAME=admin
OPENSEARCH_PASSWORD=admin

NODE_ENV=development
LOG_LEVEL=info
```

Start the app:

```bash
npm run dev
```

Sample search request:

```json
{
  "skills": "java and spring not \"full stack\"",
  "designation": "software engineer",
  "location": "Bengaluru, Karnataka, India",
  "years_of_experience": 10,
  "page": 1
}
```

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `8080` | HTTP port |
| `DB_HOST` | - | Postgres host |
| `DB_PORT` | `5432` | Postgres port |
| `DB_NAME` | `postgres` | Postgres database |
| `DB_USER` | - | Postgres user |
| `DB_PASSWORD` | - | Postgres password |
| `OPENSEARCH_URL` | - | OpenSearch base URL |
| `OPENSEARCH_INDEX` | `profiles` | OpenSearch index name |
| `OPENSEARCH_USERNAME` | - | OpenSearch username |
| `OPENSEARCH_PASSWORD` | - | OpenSearch password |
| `NODE_ENV` | `development` | Runtime environment |
| `LOG_LEVEL` | `info` | Pino log level |
