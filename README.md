# LinkedIn Profile Search — Backend

Standalone Node.js + Express API that connects to an Azure PostgreSQL database and provides full-text search over LinkedIn profiles using PostgreSQL's `ts_rank_cd` weighted scoring.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 18+ |
| Framework | Express 5 |
| Language | TypeScript |
| Database | PostgreSQL (Azure) via `pg` |
| Logging | Pino |

---

## Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/healthz` | Health check |
| `GET` | `/api/search/count` | Total match count + subset info |
| `GET` | `/api/search/profiles` | Ranked profiles (paginated, subset-aware) |
| `GET` | `/api/search/profile/:id` | Full profile detail |

### Query parameters — `/api/search/count` and `/api/search/profiles`

| Param | Type | Description |
|---|---|---|
| `skills` | string | Skill keywords (supports phrases, NOT) |
| `designation` | string | Job title / designation |
| `subset` | number | 0-indexed subset of 1 000 profiles (default `0`) |
| `page` | number | Page within the subset, 20 per page (default `1`) |

---

## Search Query Syntax

### Skills

| Input | Behaviour |
|---|---|
| `java, spring` | AND — must contain both |
| `"Full stack"` | Phrase query — words must appear adjacent |
| `java NOT docker` | NOT — exclude profiles mentioning docker |
| `java, "Full stack", NOT docker` | All combined |

### Designation

Multi-word designation is automatically treated as a phrase query.  
`Software Engineer` → searches for profiles where both words appear adjacent.

---

## Prerequisites

- **Node.js ≥ 18** ([download](https://nodejs.org))
- Access to the Azure PostgreSQL database with valid credentials

---

## Installation & Run

### 1 — Clone the repo

```bash
git clone https://github.com/Sudhakaran98/linkedin-search-backend.git
cd linkedin-search-backend
```

### 2 — Create your `.env` file

```bash
cp .env.example .env
```

Edit `.env` and fill in your database credentials:

```env
PORT=8080

DB_HOST=linkedin-scraper.postgres.database.azure.com
DB_PORT=5432
DB_NAME=postgres
DB_USER=linkedin_scraper
DB_PASSWORD=your_actual_password_here

NODE_ENV=development
LOG_LEVEL=info
```

### 3 — Install dependencies

```bash
npm install
```

### 4 — Start the dev server

```bash
npm run dev
```

Server starts at **http://localhost:8080** with hot-reload.

---

## Production Build

```bash
npm run build    # compiles TypeScript → dist/
npm start        # runs dist/index.js
```

---

## Project Structure

```
linkedin-search-backend/
├── src/
│   ├── lib/
│   │   ├── db.ts              ← PostgreSQL connection pool (pg.Pool)
│   │   ├── logger.ts          ← Pino logger
│   │   └── searchQuery.ts     ← tsquery builder (phrase, NOT, AND)
│   ├── routes/
│   │   ├── index.ts           ← Router aggregator
│   │   ├── health.ts          ← GET /api/healthz
│   │   └── search.ts          ← GET /api/search/* (count, profiles, profile/:id)
│   ├── app.ts                 ← Express app setup
│   └── index.ts               ← Entry point
├── .env.example               ← Environment variable template
├── package.json
└── tsconfig.json
```

---

## Environment Variables

See `.env.example` for all available variables.

| Variable | Default | Description |
|---|---|---|
| `PORT` | `8080` | HTTP port |
| `DB_HOST` | `linkedin-scraper.postgres.database.azure.com` | DB host |
| `DB_PORT` | `5432` | DB port |
| `DB_NAME` | `postgres` | Database name |
| `DB_USER` | `linkedin_scraper` | DB username |
| `DB_PASSWORD` | — | DB password (**required**) |
| `NODE_ENV` | `development` | `development` or `production` |
| `LOG_LEVEL` | `info` | Pino log level |
