import "./_env";
import { openDatabase } from "../src/server/db/client";
import { createUser, findUserByEmail, hashPassword } from "../src/server/modules/users/service";

const file = process.env.DB_FILE ?? "./data/people.db";
const email = (process.env.SEED_ADMIN_EMAIL ?? "admin@pvcon.in").toLowerCase();
const password = process.env.SEED_ADMIN_PASSWORD ?? "ChangeMe@2026";

async function main() {
  const { db } = openDatabase(file);
  if (findUserByEmail(db, email)) {
    console.log(`Super admin ${email} already exists in ${file}; nothing to do.`);
    return;
  }
  const passwordHash = await hashPassword(password);
  db.transaction((tx) =>
    createUser(tx, { email, name: "System Admin", roles: ["super_admin"], passwordHash, mustChangePassword: true }),
  );
  console.log(`Created super admin ${email} in ${file}. Temporary password: ${password} (must change at first sign-in).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
