import { Router, type IRouter } from "express";
import healthRouter from "./health.js";
import searchRouter from "./search.js";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/search", searchRouter);

export default router;
