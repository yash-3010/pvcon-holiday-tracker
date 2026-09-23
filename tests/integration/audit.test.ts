import { beforeEach, describe, expect, it } from "vitest";
import type { DB } from "@/server/db/client";
import { users } from "@/server/db/schema";
import { diffObjects, listAudit, writeAudit } from "@/server/modules/audit/service";
import { createTestDb } from "../helpers/db";

let db: DB;
let actorId: number;
beforeEach(() => {
  db = createTestDb();
  actorId = db.insert(users).values({ email: "hr@pvcon.in", name: "HR Person", passwordHash: "x" }).returning().get().id;
});

describe("diffObjects", () => {
  it("returns changed keys only and redacts secrets", () => {
    expect(
      diffObjects(
        { name: "A", passwordHash: "old", bankAccountEnc: "v1:a", same: 1, updatedAt: "t1" },
        { name: "B", passwordHash: "new", bankAccountEnc: "v1:b", same: 1, updatedAt: "t2" },
      ),
    ).toEqual({
      name: { from: "A", to: "B" },
      passwordHash: { from: "[redacted]", to: "[redacted]" },
      bankAccountEnc: { from: "[redacted]", to: "[redacted]" },
    });
    expect(diffObjects({ a: 1 }, { a: 1 })).toBeNull();
  });
});

describe("audit log", () => {
  it("writes and lists entries newest first with actor names", () => {
    writeAudit(db, { actorUserId: actorId, action: "user.create", entityType: "user", entityId: 5, summary: "Created" });
    writeAudit(db, { actorUserId: null, action: "job.run", entityType: "job", entityId: "system:cleanup", summary: "Ran" });
    const { rows, total } = listAudit(db);
    expect(total).toBe(2);
    expect(rows[0].action).toBe("job.run");
    expect(rows[0].actorName).toBeNull();
    expect(rows[1].actorName).toBe("HR Person");
    expect(rows[1].entityId).toBe("5");
  });

  it("filters by entity type, action prefix, actor and date range and paginates", () => {
    for (let i = 0; i < 5; i++) {
      writeAudit(db, { actorUserId: actorId, action: "settings.update", entityType: "settings", entityId: "company", summary: `s${i}` });
    }
    writeAudit(db, { actorUserId: null, action: "user.create", entityType: "user", summary: "u" });
    expect(listAudit(db, { entityType: "settings" }).total).toBe(5);
    expect(listAudit(db, { actionPrefix: "user." }).total).toBe(1);
    expect(listAudit(db, { actorUserId: actorId }).total).toBe(5);
    const page2 = listAudit(db, { entityType: "settings", page: 2, pageSize: 2 });
    expect(page2.rows).toHaveLength(2);
    const today = new Date().toISOString().slice(0, 10);
    expect(listAudit(db, { from: today, to: today }).total).toBe(6);
    expect(listAudit(db, { to: "2000-01-01" }).total).toBe(0);
  });
});
