import { db } from "@/db";
import { users } from "@/db/schema";
import { UsersClient } from "./UsersClient";

export default async function UsersPage() {
  const all = await db.select().from(users);
  return <UsersClient initial={all} />;
}
