import { copyLogsToDB } from "../../db/queries/logs.js";
import type {LogEntry, LogCopyItem, ValidationResult,} from "../../types/logs.js";

let logsBuffer: LogCopyItem[] = [];

const BUFFER_CAPACITY = 60000; 
const BATCH_FLUSH_SIZE = 8000; 
const FLUSH_TIME_INTERVAL = 50; 
const MAX_CONCURRENT_FLUSHES = 6;
const inFlightFlushes = new Set<Promise<void>>();
let flush_timer: ReturnType<typeof setTimeout> | null = null;
const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
const FIVE_MINUTES_MS = 5 * 60 * 1000;
const VALID_LEVELS = new Set(["debug", "info", "warn", "error"]);
export class BackpressureError extends Error {
    retryAfterSeconds: number;
    constructor(retryAfterSeconds = 1) {
        super("Buffer full, shedding load");
        this.name = "BackpressureError";
        this.retryAfterSeconds = retryAfterSeconds;
    }
}


function isValidLog(entry: any): ValidationResult {
    if (!entry || typeof entry !== "object") {
        return {
            valid: false,
            reason: "Log Entry Must Be An Object.",
        };
    }

    const { timestamp, level, service, message, attributes } = entry;

    if (!timestamp || typeof timestamp !== "string" || !ISO_DATE_REGEX.test(timestamp)) {
        return {
            valid: false,
            reason: "Invalid ISO 8601 timestamp.",
        };
    }

    const time_epoch = Date.parse(timestamp);
    if (Number.isNaN(time_epoch)) {
        return {
            valid: false,
            reason: "Invalid ISO 8601 timestamp.",
        };
    }
    if (time_epoch > Date.now() + FIVE_MINUTES_MS) {
        return {
            valid: false,
            reason: "Timestamp cannot be more than 5 minutes in the future.",
        };
    }

    if (!VALID_LEVELS.has(level)) {
        return {
            valid: false,
            reason: "Invalid Level, Must be debug, info, warn, or error.",
        };
    }

    if (!service || typeof service !== "string" || service.length === 0 || service.length > 64) {
        return { valid: false, reason: "Invalid Service." };
    }

    if (!message || typeof message !== "string" || message.length === 0) {
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
            timestamp: timestamp,
            level: level,
            service: service.trim(),
            message: message.trim(),
            attributes: JSON.stringify(attributes ?? {}),
        },
    };
}


function scheduleFlush() {
    if (flush_timer || logsBuffer.length === 0) {
        return;
    }

    flush_timer = setTimeout(() => {
        flush_timer = null;

        void flush().catch((error) => {
            console.error("[flush] scheduled flush failed", error);
        });
    }, FLUSH_TIME_INTERVAL);
}

export async function flush() {
    if (logsBuffer.length === 0 ) {
        return;
    }

    if (inFlightFlushes.size >= MAX_CONCURRENT_FLUSHES) {
        scheduleFlush();
        return ;
    }

    const batch_to_add = logsBuffer.splice(0,BATCH_FLUSH_SIZE);

    const task = (async () => {
        try {
            await copyLogsToDB(batch_to_add);
        } catch (error) {
            console.error("[flush] batch failed", {
                size: batch_to_add.length,
                error,
            });
            logsBuffer.unshift(...batch_to_add);
            throw error;
        }
    })();

    inFlightFlushes.add(task);
    task.catch(() => {}).finally(() => {
        inFlightFlushes.delete(task);
            if (logsBuffer.length >= BATCH_FLUSH_SIZE) {
                void flush().catch((error) => {
                    console.error("[flush] follow-up flush failed", error);
                });
            } else if (logsBuffer.length > 0) {
                scheduleFlush();
            }
    });

    return task;
}

export async function ingest(logs: LogEntry[]) {

     if (logsBuffer.length + logs.length > BUFFER_CAPACITY) {
        if (inFlightFlushes.size < MAX_CONCURRENT_FLUSHES) {
            void flush().catch(() => {});
        }
        throw new BackpressureError(1);
    }

    const rejected: { index: number; reason: string }[] = [];
    let ingested_count = 0;
    for (let i = 0; i < logs.length; i++){
        const log = logs[i];
        const index = i;

        while(logsBuffer.length >= BUFFER_CAPACITY) {
            if (inFlightFlushes.size > 0) {
                await Promise.race(Array.from(inFlightFlushes)).catch(() => {});
            }
            else {
            void flush().catch(() => {});
            await new Promise((r) => setTimeout(r, 10));
        }
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
        void flush().catch((error) => {
            console.error("[ingest] background flush failed", error);
        });
    } else {
        scheduleFlush();
    }

    return { ingested: ingested_count, rejected };
}