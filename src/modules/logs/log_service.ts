import { copyLogsToDB } from "../../db/queries/logs_copy.js";
import type {LogEntry, LogCopyItem, ValidationResult,} from "../../types/logs.js";

let logsBuffer: LogCopyItem[] = [];

const BUFFER_CAPACITY = 30000; 
const BATCH_FLUSH_SIZE = 5000; 
const FLUSH_TIME_INTERVAL = 100; 

let flush_timer: ReturnType<typeof setTimeout> | null = null;
let is_flushing = false;

function isValidLog(entry: any): ValidationResult {
    if (!entry || typeof entry !== "object") {
        return {
            valid: false,
            reason: "Log Entry Must Be An Object.",
        };
    }

    const { timestamp, level, service, message, attributes } = entry;

    if (!timestamp || isNaN(Date.parse(timestamp))) {
        return {
            valid: false,
            reason: "Invalid ISO 8601 timestamp.",
        };
    }

    const log_date = new Date(timestamp);
    const now = new Date();

    if (log_date.getTime() > now.getTime() + 5 * 60 * 1000) {
        return {
            valid: false,
            reason: "Timestamp cannot be more than 5 minutes in the future.",
        };
    }

    const valid_levels = ["debug", "info", "warn", "error"];

    if (!valid_levels.includes(level)) {
        return {
            valid: false,
            reason: "Invalid Level, Must be debug, info, warn, or error.",
        };
    }

    if (!service || typeof service !== "string" || service.trim() === "") {
        return {
            valid: false,
            reason: "Service Must Be non-empty String.",
        };
    }

    if (!message || typeof message !== "string" || message.trim() === "") {
        return {
            valid: false,
            reason: "Message Must Be non-empty String.",
        };
    }

    if (attributes !== undefined) {
        if (typeof attributes !== "object" || attributes === null || Array.isArray(attributes)) {
            return {
                valid: false,
                reason: "Attributes Must Be A Flat Object",
            };
        }

        for (const val of Object.values(attributes)) {
            if (typeof val !== "string" && typeof val !== "number" && typeof val !== "boolean") {
                return {
                    valid: false,
                    reason: "Attributes Must Be String, Number, Or Boolean",
                };
            }
        }
    }

    return {
        valid: true,
        data: {
            timestamp: new Date(timestamp).toISOString(),
            level: level,
            service: service.trim(),
            message: message.trim(),
            attributes: JSON.stringify(attributes ?? {}),
        },
    };
}

export async function flush() {
    if (logsBuffer.length === 0 || is_flushing) {
        return;
    }

    is_flushing = true;

    const batch_to_add = logsBuffer;
    logsBuffer = [];

    try {
        await copyLogsToDB(batch_to_add);
    } catch (error) {
        console.log("Error during Bulk Copy to DB:", error);
        if (logsBuffer.length + batch_to_add.length <= BUFFER_CAPACITY) {
            logsBuffer = [...batch_to_add, ...logsBuffer];
        }
    } finally {
        is_flushing = false;
    }
}

export async function ingest(logs: LogEntry[]) {
    if (!Array.isArray(logs) || logs.length === 0) {
        return { ingested: 0, rejected: [] };
    }

    const rejected: { index: number; reason: string }[] = [];
    let ingested_count = 0;

    for (const [index, log] of logs.entries()) {
        if (logsBuffer.length >= BUFFER_CAPACITY) { 
            await flush();
        }

        const validate_log = isValidLog(log);

        if (validate_log.valid) {
            logsBuffer.push(validate_log.data);
            ingested_count++;
        } else {
            rejected.push({
                index,
                reason: validate_log.reason, 
            });
        }
    }

    if (logsBuffer.length >= BATCH_FLUSH_SIZE) { 
        setImmediate(() => flush());
    } else if (!flush_timer) {
        flush_timer = setTimeout(() => {
            flush_timer = null;
            flush();
        }, FLUSH_TIME_INTERVAL);
    }
    
    return { ingested: ingested_count, rejected };
}