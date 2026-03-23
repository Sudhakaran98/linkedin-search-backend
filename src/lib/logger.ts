type LogLevel = "debug" | "info" | "warn" | "error";

type LogContext = Record<string, unknown>;

export interface AppLogger {
  child(bindings: LogContext): AppLogger;
  debug(context: unknown, message?: string): void;
  info(context: unknown, message?: string): void;
  warn(context: unknown, message?: string): void;
  error(context: unknown, message?: string): void;
}

const levelOrder: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function normalizeLevel(value: string | undefined): LogLevel {
  const lowered = value?.toLowerCase();
  return lowered === "debug" || lowered === "info" || lowered === "warn" || lowered === "error"
    ? lowered
    : "info";
}

function serializeError(error: unknown) {
  if (!(error instanceof Error)) {
    return error;
  }

  return {
    name: error.name,
    message: error.message,
    stack: error.stack,
  };
}

function sanitize(value: unknown): unknown {
  if (value instanceof Error) {
    return serializeError(value);
  }

  if (Array.isArray(value)) {
    return value.map(sanitize);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
        key,
        sanitize(entry),
      ])
    );
  }

  return value;
}

class ConsoleLogger implements AppLogger {
  constructor(
    private readonly bindings: LogContext = {},
    private readonly minLevel: LogLevel = normalizeLevel(process.env.LOG_LEVEL)
  ) {}

  child(bindings: LogContext): AppLogger {
    return new ConsoleLogger({ ...this.bindings, ...bindings }, this.minLevel);
  }

  debug(context: unknown, message?: string): void {
    this.write("debug", context, message);
  }

  info(context: unknown, message?: string): void {
    this.write("info", context, message);
  }

  warn(context: unknown, message?: string): void {
    this.write("warn", context, message);
  }

  error(context: unknown, message?: string): void {
    this.write("error", context, message);
  }

  private write(level: LogLevel, context: unknown, message?: string): void {
    if (levelOrder[level] < levelOrder[this.minLevel]) {
      return;
    }

    const contextPayload: LogContext =
      typeof context === "object" && context !== null
        ? (sanitize(context) as LogContext)
        : { value: sanitize(context) };

    const payload = {
      time: new Date().toISOString(),
      level,
      msg: message,
      ...this.bindings,
      ...contextPayload,
    };

    const line = JSON.stringify(payload);

    if (level === "error") {
      console.error(line);
      return;
    }

    console.log(line);
  }
}

export const logger: AppLogger = new ConsoleLogger();

declare module "express-serve-static-core" {
  interface Request {
    log: AppLogger;
  }
}
