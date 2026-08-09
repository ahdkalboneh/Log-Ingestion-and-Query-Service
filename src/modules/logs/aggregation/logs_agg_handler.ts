import type{ Request, Response } from "express";
import { aggregateLogsFromDB } from "../../../db/queries/logs_agg.js";
import type { AggregateLogFilters } from "../../../types/logs.js";

const VALID_BUCKETS = ["1m", "5m", "1h", "1d"];
const VALID_GROUP_BY = ["service", "level"];


export async function logsAggHandler(req: Request, res:Response){
    try{
        const {since, until, bucket, group_by, service, level, q,} = req.query;

        if(typeof since !== "string" || !since){
            return res.status(400).json({
                error: "since is required",
            });
        }
        if(typeof until !== "string" || !until){
            return res.status(400).json({
                error: "until is required",
            });
        }
         if (typeof bucket !== "string" || !VALID_BUCKETS.includes(bucket)) {
            return res.status(400).json({
                error: "bucket must be one of: 1m, 5m, 1h, 1d",
            });
        }

        if(group_by !== undefined && (typeof group_by !== "string" || !VALID_GROUP_BY.includes(group_by))){
            return res.status(400).json({
                error: "group_by must be service or level",
            });
        }

        const sinceDate = new Date(since);
        const untilDate = new Date(until);

        if (
            Number.isNaN(sinceDate.getTime()) ||
            Number.isNaN(untilDate.getTime())
        ) {
            return res.status(400).json({
                error: "Invalid timestamps",
            });
        }

        if (untilDate <= sinceDate) {
            return res.status(400).json({
                error: "until must be later than since",
            });
        }

        const filters: AggregateLogFilters = {
            since,
            until,
            bucket: bucket  as AggregateLogFilters["bucket"],
        }

        const attributes: Record<string, string> = {};
        for (const [key, value] of Object.entries(req.query)) {
            if (key.startsWith("attr.") && typeof value === "string") {
                const attrKey = key.slice("attr.".length);
                attributes[attrKey] = value;
            }
        }
        
        if (Object.keys(attributes).length > 0){
             filters.attributes = attributes;
        }
        
        if (typeof group_by === "string") {
            filters.group_by =
                group_by as "service" | "level";
        }

        if(typeof service === "string"){
            filters.service = service;
        }

         if (typeof level === "string") {
            filters.level = level;
        }

        if (typeof q === "string") {
            filters.q = q;
        }

        const result = await aggregateLogsFromDB(filters);
              return res.status(200).json({
            buckets: result,
        });

    }catch(error){
        console.error(" Aggregation error:", error);
        return res.status(500).json({
            error: "Internal server error",
        });
    }
}
