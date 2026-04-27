import { auth } from "@/auth";
import { listUserLeaves, getUserBalance } from "@/lib/leaves";
import { currentYear } from "@/lib/utils";
import { LeavesClient } from "./LeavesClient";

export default async function LeavesPage() {
  const session = await auth();
  const userId = Number(session!.user.id);
  const year = currentYear();
  const initial = await listUserLeaves(userId, year);
  const balance = await getUserBalance(userId, year);
  return <LeavesClient initial={initial} year={year} maxConsecutive={balance.policy.maxConsecutiveDays} />;
}
