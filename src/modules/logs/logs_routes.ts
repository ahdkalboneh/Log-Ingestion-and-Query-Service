import { Router } from "express";
import { ingestLogsHandler, queryLogsHandler } from "./logs_handler.js";

const router = Router();
router.post("/", ingestLogsHandler);
router.get("/", queryLogsHandler);

export default router;