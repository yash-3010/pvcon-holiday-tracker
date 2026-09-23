import "server-only";
import { config } from "@/server/config";
import { openDatabase, type DB } from "./client";

const globalForDb = globalThis as unknown as { __pvconDb?: ReturnType<typeof openDatabase> };
const connection = globalForDb.__pvconDb ?? openDatabase(config.dbFile);
if (process.env.NODE_ENV !== "production") globalForDb.__pvconDb = connection;

export const db: DB = connection.db;
export type { DB, DbLike } from "./client";
