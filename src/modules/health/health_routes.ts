import { Router } from "express";
import { healthHandler } from "./health_handler.js";

const router = Router();
router.get("/", healthHandler);

export default router;