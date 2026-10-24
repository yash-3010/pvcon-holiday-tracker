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
  /** Optional PKCS#12 certificate for signing released payslips. */
  get payslipSigning(): { p12Path: string; passphrase: string } | null {
    const p12Path = process.env.PAYSLIP_SIGN_P12_PATH?.trim();
    return p12Path ? { p12Path, passphrase: process.env.PAYSLIP_SIGN_P12_PASSWORD ?? "" } : null;
  },
};
