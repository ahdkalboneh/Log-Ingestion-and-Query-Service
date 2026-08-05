import { Router } from "express";
import { ingestLogsHandler } from "./logs_handler.js";

const router = Router();
router.post("/", ingestLogsHandler);

export default router;