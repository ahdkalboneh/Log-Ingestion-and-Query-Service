import express from "express";
import healthRoutes from "./modules/health/health_routes.js";
import logsRoutes from "./modules/logs/logs_routes.js"
import type { Request, Response, NextFunction } from "express";

export const app = express();

// JSON error middleware
app.use((err: SyntaxError, req: Request, res: Response, next: NextFunction) => {
    if (err instanceof SyntaxError) {
      return res.status(400).json({
        accepted: 0,
        rejected: [],
        error: "Malformed JSON request body",
      });
    }
    next(err);
  }
);

app.use(express.json());
app.use("/health", healthRoutes);
app.use("/logs", logsRoutes);