import { pino, stdTimeFunctions, type Logger, type LoggerOptions } from "pino";

export type { Logger };

/** Fields that must never reach logs, wherever they appear in a log object. */
export const REDACTED_PATHS = [
  "password",
  "*.password",
  "token",
  "*.token",
  "accessToken",
  "*.accessToken",
  "refreshToken",
  "*.refreshToken",
  "apiKey",
  "*.apiKey",
  "req.headers.authorization",
  "req.headers.cookie",
  'res.headers["set-cookie"]',
];

export interface CreateLoggerOptions extends LoggerOptions {
  /** Pretty, human-readable output. Defaults to true in development on a terminal. */
  pretty?: boolean;
}

export function createLogger(service: string, options: CreateLoggerOptions = {}): Logger {
  const { pretty, ...pinoOptions } = options;
  const isProduction = process.env.NODE_ENV === "production";
  const usePretty = pretty ?? (!isProduction && process.stdout.isTTY === true);

  return pino({
    name: service,
    level: process.env.LOG_LEVEL ?? (isProduction ? "info" : "debug"),
    base: { service },
    timestamp: stdTimeFunctions.isoTime,
    redact: { paths: REDACTED_PATHS, censor: "[redacted]" },
    ...(usePretty ? { transport: { target: "pino-pretty", options: { colorize: true } } } : {}),
    ...pinoOptions,
  });
}
