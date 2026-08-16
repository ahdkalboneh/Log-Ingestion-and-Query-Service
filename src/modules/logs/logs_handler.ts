import type{ Request, Response } from "express";
import { ingest, BackpressureError } from "./logs_ingest_service.js";
import { queryLogsFromDB } from "../../db/queries/logs.js";
import type { LogFilters } from "../../types/logs.js";
 
const ALLOWED_LOG_LEVELS = new Set(["debug", "info", "warn", "error"]);
const MIN_LIMIT = 1;
const MAX_LIMIT = 1000;

export async function ingestLogsHandler(req: Request, res:Response){
    try{
    const {logs} = req.body;
    if(!Array.isArray(logs)){
        return res.status(400).json({
            accepted: 0,
            rejected: [],
            error: "Request body must contain a logs array",
        });
    }
    const result =  await ingest(logs);

    return res.status(200).json({
        accepted: result.ingested,
        rejected: result.rejected,
    });
} catch(error) {
  if (error instanceof BackpressureError){
    res.setHeader("Retry-After", String(error.retryAfterSeconds));
    return res.status(503).json({
      accepted: 0,
      rejected: [],
      error: "server busy, retry shortly",
    });
  }
   return res.status(500).json({
    accepted: 0,
    rejected: [],
    error: "Internal server error",
  });
}
}

export async function queryLogsHandler(req: Request, res:Response) {
    try {

    const { service, level, since, until, q } = req.query;
    if (typeof level === "string" && !ALLOWED_LOG_LEVELS.has(level.toLowerCase())) {
      return res.status(400).json({
        error: `Unsupported log level: '${level}'.`
      });
    }
    let limit = "100";

    let cursor: string | null = null;

    if (typeof req.query.limit === "string") {
        limit = req.query.limit;
    }
    if (typeof limit !== "string" || !/^\d+$/.test(limit)) {
        return res.status(400).json({ error: "Limit must be a valid numeric integer" });
    }

    let parsedLimit = parseInt(limit, 10);

    if (parsedLimit < MIN_LIMIT || parsedLimit > MAX_LIMIT) {
        return res.status(400).json({
          error: `Limit must be between ${MIN_LIMIT} and ${MAX_LIMIT}`
        });
    }

    let sinceTime: number | null = null;
    let untilTime: number | null = null;

    if (typeof since === "string") {
      sinceTime = Date.parse(since);
      if (isNaN(sinceTime)) {
        return res.status(400).json({ error: "Invalid timestamp format for 'since'" });
      }
    }

    if (typeof until === "string") {
      untilTime = Date.parse(until);
      if (isNaN(untilTime)) {
        return res.status(400).json({ error: "Invalid timestamp format for 'until'" });
      }
    }

    if (sinceTime !== null && untilTime !== null && untilTime < sinceTime) {
      return res.status(400).json({ error: "'until' timestamp cannot be earlier than 'since' timestamp" });
    }

    if (typeof req.query.cursor === "string") {
        try {
            const decoded = Buffer.from(req.query.cursor, "base64").toString("utf-8");
            const parsedCursor = JSON.parse(decoded);
            if (typeof parsedCursor.id !== "number" || typeof parsedCursor.timestamp !== "string" || isNaN(Date.parse(parsedCursor.timestamp))){
                return res.status(400).json({
                    error: "Invalid or malformed cursor"
                });
    }
    cursor = req.query.cursor;
    }
     catch {
    return res.status(400).json({
      error: "Invalid or malformed cursor"
    });
    }
 }

    const attributes: Record<string, string> = {};

    for (const [key, value] of Object.entries(req.query)) {
      if (key.startsWith("attr.") && typeof value === "string") {
        attributes[key.slice(5)] = value;
      }
    }

    const filters: LogFilters = {
      limit,
      cursor,
    };

    if (typeof service === "string") {
      filters.service = service;
    }

    if (typeof level === "string") {
      filters.level = level;
    }

    if (typeof since === "string") {
      filters.since = since;
    }

    if (typeof until === "string") {
      filters.until = until;
    }

    if (typeof q === "string") {
      filters.q = q;
    }

    if (Object.keys(attributes).length > 0) {
      filters.attributes = attributes;
    }

    const result = await queryLogsFromDB(filters);
    return res.status(200).json(result);

  } catch (error) {
    return res.status(500).json({
      error: "Internal server error",
    });
  }
}
