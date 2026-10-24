import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  use: { baseURL: `http://localhost:${PORT}`, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `rm -f data/e2e.db data/e2e.db-wal data/e2e.db-shm && npm run db:migrate && npm run db:seed && npx next dev --port ${PORT}`,
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 180_000,
    env: {
      DB_FILE: "./data/e2e.db",
      UPLOAD_DIR: "./data/e2e-uploads",
      AUTH_SECRET: "e2e-secret-e2e-secret-e2e-secret-e2e-secret",
      AUTH_TRUST_HOST: "true",
      APP_URL: `http://localhost:${PORT}`,
      DATA_ENCRYPTION_KEY: "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=",
      CRON_SECRET: "e2e-cron-secret",
      SEED_ADMIN_EMAIL: "admin@pvcon.in",
      SEED_ADMIN_PASSWORD: "ChangeMe@2026",
      LOG_LEVEL: "warn",
    },
  },
});
