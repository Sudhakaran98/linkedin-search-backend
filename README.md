# LinkedIn Search — Backend API

  Node.js + Express API server for LinkedIn Profile Search.

  ## Stack
  - Node.js + TypeScript
  - Express 5
  - PostgreSQL (Azure) via `pg`
  - Raw SQL with PostgreSQL full-text search (`tsv_search`, `ts_rank_cd`)
  - Zod validation

  ## API Endpoints

  | Method | Path | Description |
  |--------|------|-------------|
  | GET | `/api/search/count` | Total count of matching profiles and subset metadata |
  | GET | `/api/search/profiles` | Ranked profiles for a given subset and page |
  | GET | `/api/search/profile/:id` | Full profile detail (experience, education, skills) |

  ### Query Parameters
  - `skills` — comma/space separated skills (e.g. `java, spring, sql`)
  - `designation` — job title (e.g. `Software Engineer`)
  - `subset` — 0-indexed subset (each subset = 1000 profiles)
  - `page` — page within subset (20 profiles per page)

  ## Setup
  ```bash
  npm install
  ```

  ## Environment Variables
  | Variable | Description |
  |----------|-------------|
  | `PORT` | Port to listen on |
  | `LINKEDIN_PASSWORD` | Azure PostgreSQL password |

  Database host: `linkedin-scraper.postgres.database.azure.com`  
  User: `linkedin_scraper`

  ## Run
  ```bash
  npm run dev
  ```
  