import pg from "pg";

const { Pool } = pg;

const linkedinPool = new Pool({
  host: "linkedin-scraper.postgres.database.azure.com",
  port: 5432,
  database: "postgres",
  user: "linkedin_scraper",
  password: process.env.LINKEDIN_PASSWORD,
  ssl: {
    rejectUnauthorized: false,
  },
  max: 10,
  min: 2,
  idleTimeoutMillis: 10000,
  connectionTimeoutMillis: 30000,
});

export default linkedinPool;
