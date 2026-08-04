import express from "express";
import type { Request, Response } from "express";

export const app = express();
app.use(express.json());

let isReady = false;

export function setReady() {
  isReady = true;
}

export function healthHandler(req: Request, res: Response) {
  if (!isReady) {
    return res.status(503).json({
      status: "unhealthy",
    });
  }

  return res.status(200).json({
    status: "ok",
  });
}

app.get("/health", healthHandler);
