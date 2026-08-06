import express from "express";
import healthRoutes from "./modules/health/health_routes.js";
import logsRoutes from "./modules/logs/logs_routes.js"
import type { Request, Response, NextFunction } from "express";

export const app = express();

app.get("/test", (req, res) => {
  res.json({ok:true});
});

app.use(express.json({limit: "50mb"}));
app.use("/health", healthRoutes);
app.use("/logs", logsRoutes);

app.use((err: SyntaxError, req: Request, res: Response, next: NextFunction) => {
  if (err instanceof SyntaxError && "body" in err) {
    return res.status(400).json({
      accepted: 0,
      rejected: [],
      error: "Malformed JSON request body",
    });
  }

  next(err);
});