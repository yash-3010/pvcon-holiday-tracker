// Deterministic env for unit/integration tests. 32-byte key, base64.
process.env.DATA_ENCRYPTION_KEY ??= "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=";
process.env.CRON_SECRET ??= "test-cron-secret";
process.env.ALLOWED_EMAIL_DOMAIN ??= "pvcon.in";
process.env.LOG_LEVEL ??= "silent";

// Actions schedule notification email with `after()` from next/server, which needs a Next.js request scope.
import { vi } from "vitest";
vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), after: () => {} }));
