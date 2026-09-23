import pino from "pino";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === "test" ? "silent" : "info"),
  base: { app: "pvcon-people" },
  redact: {
    paths: ["password", "*.password", "passwordHash", "*.passwordHash", "token", "*.token"],
    censor: "[redacted]",
  },
});
