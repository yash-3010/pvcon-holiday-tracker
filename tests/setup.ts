// Deterministic env for unit/integration tests. 32-byte key, base64.
process.env.DATA_ENCRYPTION_KEY ??= "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=";
process.env.CRON_SECRET ??= "test-cron-secret";
process.env.ALLOWED_EMAIL_DOMAIN ??= "pvcon.in";
process.env.LOG_LEVEL ??= "silent";
