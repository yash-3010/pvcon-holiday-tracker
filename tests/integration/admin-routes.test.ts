import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionUser } from "@/lib/auth/types";
import type { DB } from "@/server/db/client";
import { auditLogs, type FileRow } from "@/server/db/schema";
import { runJob } from "@/server/jobs/runner";
import { saveUpload } from "@/server/modules/files/service";
import { patchSetting } from "@/server/modules/settings/service";
import { createTestDb } from "../helpers/db";
import { insertUser, sessionUserFor } from "../helpers/fixtures";

// Only the Next.js runtime boundary and the session lookup are replaced; routes, DB and services are real.
const state = vi.hoisted(() => ({ db: undefined as unknown as DB, user: null as SessionUser | null }));
vi.mock("@/server/db", () => ({
  get db() {
    return state.db;
  },
}));
vi.mock("@/server/auth/session", () => ({ getCurrentUser: async () => state.user }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

import { runJobAction } from "@/app/(app)/settings/jobs/actions";
import { POST as cronPost } from "@/app/api/cron/[job]/route";
import { GET as filesGet } from "@/app/api/files/[id]/route";
import { GET as healthGet } from "@/app/api/health/route";
import { listRecentJobRuns } from "@/server/jobs/queries";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
let dir: string;
let asSuper: SessionUser;
let asHr: SessionUser;
const jobAudits = () => state.db.select().from(auditLogs).where(eq(auditLogs.action, "job.run")).all();

beforeEach(() => {
  state.db = createTestDb();
  asSuper = sessionUserFor(state.db, insertUser(state.db, { roles: ["super_admin"] }));
  asHr = sessionUserFor(state.db, insertUser(state.db, { roles: ["hr_admin"] }));
  state.user = null;
  dir = mkdtempSync(path.join(tmpdir(), "pvcon-routes-"));
  vi.stubEnv("UPLOAD_DIR", dir);
  vi.stubEnv("DB_FILE", path.join(dir, "people.db"));
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

describe("POST /api/cron/[job]", () => {
  const call = (job: string, authorization?: string) =>
    cronPost(
      new Request(`http://localhost/api/cron/${job}`, { method: "POST", headers: authorization ? { authorization } : {} }),
      { params: Promise.resolve({ job }) },
    );

  it("rejects a missing or wrong bearer token", async () => {
    expect((await call("system:cleanup")).status).toBe(401);
    expect((await call("system:cleanup", "Bearer wrong")).status).toBe(401);
    expect(jobAudits()).toEqual([]);
  });

  it("refuses every call while CRON_SECRET is unset", async () => {
    vi.stubEnv("CRON_SECRET", "");
    expect((await call("system:cleanup", "Bearer ")).status).toBe(401);
  });

  it("runs a job once per period, auditing only real runs", async () => {
    const first = await call("system%3Acleanup", "Bearer test-cron-secret");
    expect(first.status).toBe(200);
    await expect(first.json()).resolves.toMatchObject({ status: "succeeded" });

    const second = await call("system:cleanup", "Bearer test-cron-secret");
    expect(second.status).toBe(200);
    await expect(second.json()).resolves.toMatchObject({ status: "skipped" });
    expect(jobAudits()).toHaveLength(1);
    expect(jobAudits()[0]!.actorUserId).toBeNull();
  });

  it("returns 404 for unknown jobs", async () => {
    expect((await call("nope:job", "Bearer test-cron-secret")).status).toBe(404);
  });
});

describe("GET /api/health", () => {
  it("reports ok when the database, migrations and storage are fine", async () => {
    const res = healthGet();
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      status: "ok",
      checks: { database: "ok", migrations: "ok", storage: "ok" },
    });
  });

  it("is degraded when a migration is missing or storage is not writable", async () => {
    // drizzle's table declares `id SERIAL`, which SQLite leaves NULL; rowid identifies the rows.
    state.db.run(sql`delete from __drizzle_migrations where rowid = (select max(rowid) from __drizzle_migrations)`);
    vi.stubEnv("DB_FILE", "/proc/pvcon-no-such-dir/people.db");
    const res = healthGet();
    expect(res.status).toBe(503);
    const body = (await res.json()) as { status: string; checks: Record<string, string> };
    expect(body.status).toBe("degraded");
    expect(body.checks.migrations).toMatch(/^pending/);
    expect(body.checks.storage).toBe("not writable");
  });
});

describe("GET /api/files/[id]", () => {
  let hrPdf: FileRow;
  let logo: FileRow;
  let csv: FileRow;
  const get = (id: number | string, query = "") =>
    filesGet(new Request(`http://localhost/api/files/${id}${query}`), { params: Promise.resolve({ id: String(id) }) });

  beforeEach(() => {
    hrPdf = saveUpload(state.db, { data: Buffer.from("%PDF-1.7 hr"), originalName: "offer letter.pdf", allowed: ["pdf"], uploadedBy: asHr.id, uploadDir: dir });
    csv = saveUpload(state.db, { data: Buffer.from("a,b\n1,2\n"), originalName: "data.csv", allowed: ["csv"], uploadedBy: asHr.id, uploadDir: dir });
    logo = saveUpload(state.db, { data: PNG, originalName: "logo.png", allowed: ["png"], uploadedBy: asSuper.id, uploadDir: dir });
    patchSetting(state.db, "company", { logoFileId: logo.id }, asSuper.id);
  });

  it("requires a session", async () => {
    expect((await get(hrPdf.id)).status).toBe(401);
  });

  it("refuses users who still have to change a temporary password", async () => {
    state.user = sessionUserFor(state.db, insertUser(state.db, { roles: ["super_admin"], mustChangePassword: true }));
    expect((await get(logo.id, "?inline=1")).status).toBe(403);
  });

  it("hides files the user may not read behind a 404", async () => {
    const employee = sessionUserFor(state.db, insertUser(state.db, { roles: ["employee"] }));
    state.user = employee;
    expect((await get(hrPdf.id)).status).toBe(404);
    expect((await get("abc")).status).toBe(404);
    expect((await get(9999)).status).toBe(404);
  });

  it("serves an uploader's own file as an attachment with safe headers", async () => {
    state.user = asHr;
    const res = await get(hrPdf.id);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("content-disposition")).toBe("attachment; filename*=UTF-8''offer%20letter.pdf");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(Buffer.from(await res.arrayBuffer()).toString()).toBe("%PDF-1.7 hr");
  });

  it("shows the company logo inline to any signed-in user, but never inlines other types", async () => {
    state.user = sessionUserFor(state.db, insertUser(state.db, { roles: ["employee"] }));
    const logoRes = await get(logo.id, "?inline=1");
    expect(logoRes.status).toBe(200);
    expect(logoRes.headers.get("content-disposition")).toMatch(/^inline;/);

    state.user = asHr;
    const csvRes = await get(csv.id, "?inline=1");
    expect(csvRes.headers.get("content-disposition")).toMatch(/^attachment;/);
  });
});

describe("runJobAction", () => {
  it("runs a registered job for a job.run holder and audits it", async () => {
    state.user = asSuper;
    await expect(runJobAction({ name: "system:cleanup" })).resolves.toMatchObject({ ok: true, data: { status: "succeeded" } });
    expect(jobAudits()).toHaveLength(1);
    expect(jobAudits()[0]!.actorUserId).toBe(asSuper.id);
  });

  it("rejects unknown jobs and users without job.run", async () => {
    state.user = asSuper;
    await expect(runJobAction({ name: "nope:job" })).resolves.toMatchObject({ ok: false, code: "UNKNOWN_JOB" });
    state.user = asHr;
    await expect(runJobAction({ name: "system:cleanup" })).resolves.toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(jobAudits()).toEqual([]);
  });
});

describe("listRecentJobRuns", () => {
  it("returns the newest runs first, up to the limit", () => {
    runJob(state.db, "a:job", "k1", () => "one", new Date("2026-09-01T00:00:00Z"));
    runJob(state.db, "b:job", "k1", () => "two", new Date("2026-09-03T00:00:00Z"));
    runJob(state.db, "c:job", "k1", () => "three", new Date("2026-09-02T00:00:00Z"));
    expect(listRecentJobRuns(state.db, 2).map((r) => r.job)).toEqual(["b:job", "c:job"]);
  });
});
