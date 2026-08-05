export type LogEntry = {
    timestamp: string;
    level: "debug" | "info" | "warn" | "error";
    service: string;
    message: string;
    attributes?: Record<string, any>;
};

export type LogCopyItem = {
    timestamp: string;
    level: string;
    service: string;
    message: string;
    attributes: string;
};

export type ValidationResult =
  | { valid: true; data: LogCopyItem }
  | { valid: false; reason: string };
