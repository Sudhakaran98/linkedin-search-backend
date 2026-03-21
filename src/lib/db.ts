import pg from "pg";

const { Pool } = pg;

const pool = new Pool({
  host:     process.env.DB_HOST     ?? "linkedin-scraper.postgres.database.azure.com",
  port:     parseInt(process.env.DB_PORT ?? "5432", 10),
  database: process.env.DB_NAME     ?? "postgres",
  user:     process.env.DB_USER     ?? "linkedin_scraper",
  password: process.env.DB_PASSWORD ?? process.env.LINKEDIN_PASSWORD,
  ssl: { rejectUnauthorized: false },
  max: 10,
  min: 2,
  idleTimeoutMillis:    10_000,
  connectionTimeoutMillis: 30_000,
});

export default pool;
