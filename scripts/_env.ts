import { existsSync } from "node:fs";

// Load .env.local / .env for CLI scripts. Variables already in the environment win.
for (const file of [".env.local", ".env"]) {
  if (existsSync(file)) process.loadEnvFile(file);
}
