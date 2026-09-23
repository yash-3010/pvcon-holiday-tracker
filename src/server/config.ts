/** Runtime configuration from environment variables, read lazily so tests can override them. */
export const config = {
  get dbFile() {
    return process.env.DB_FILE ?? "./data/people.db";
  },
  get appUrl() {
    return (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  },
  get allowedEmailDomain() {
    return (process.env.ALLOWED_EMAIL_DOMAIN ?? "pvcon.in").toLowerCase();
  },
  get uploadDir() {
    return process.env.UPLOAD_DIR ?? "./data/uploads";
  },
  get cronSecret() {
    return process.env.CRON_SECRET ?? "";
  },
};
