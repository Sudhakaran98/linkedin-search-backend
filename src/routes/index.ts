import { Router, type IRouter } from "express";
import healthRouter from "./health.js";
import apiRouter from "./api.js";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/search", apiRouter);

export default router;
