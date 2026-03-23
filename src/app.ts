import { randomUUID } from "node:crypto";
import express, { type Express } from "express";
import cors from "cors";
import router from "./routes/index.js";
import { logger } from "./lib/logger.js";

const app: Express = express();

app.use((req, res, next) => {
  const requestId = randomUUID();
  const startedAt = Date.now();

  req.log = logger.child({
    requestId,
    method: req.method,
    path: req.originalUrl.split("?")[0],
  });

  res.on("finish", () => {
    req.log.info(
      {
        statusCode: res.statusCode,
        durationMs: Date.now() - startedAt,
      },
      "Request completed"
    );
  });

  next();
});
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

export default app;
