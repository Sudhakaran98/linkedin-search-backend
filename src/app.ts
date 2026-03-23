import express, { type Express, type Request, type Response } from "express";
import cors from "cors";
import { pinoHttp, type ReqId } from "pino-http";
import router from "./routes/index.js";
import { logger } from "./lib/logger.js";

const app: Express = express();

type RequestWithId = Request & { id?: ReqId };

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req: RequestWithId) {
        return { id: req.id, method: req.method, url: req.url?.split("?")[0] };
      },
      res(res: Response) {
        return { statusCode: res.statusCode };
      },
    },
  })
);
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

export default app;
