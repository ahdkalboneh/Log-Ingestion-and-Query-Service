import type{ Request, Response } from "express";
import { ingest } from "./log_service.js";

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

    const result = await ingest(logs);
    if(result.ingested === 0){
        return res.status(400).json({result});
    }

    return res.status(200).json({
        accepted: result.ingested,
        rejected: result.rejected,
    });
} catch(error) {
     console.error(error);

    return res.status(400).json({
      accepted: 0,
      rejected: [],
      error: "Malformed JSON request body",
    });
}
}

