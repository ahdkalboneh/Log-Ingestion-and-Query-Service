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

export type LogFilters = {
  limit: string;
  service?: string;
  level?: string;
  since?: string;
  until?: string;
  attributes?: Record<string, string>;
  q?: string;
  cursor?: string | null;
};

export type AggregateLogFilters = {
    since: string;
    until: string;
    bucket: "1m" | "5m" | "1h" | "1d";
    group_by?: "service" | "level";
    service?: string;
    level?: string;
    q?: string;
    attributes?: Record<string, string>;
};