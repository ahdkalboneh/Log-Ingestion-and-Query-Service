import { Router } from "express";
import { logsAggHandler } from "./logs_agg_handler.js";

const router = Router();
router.get("/", logsAggHandler);

export default router;