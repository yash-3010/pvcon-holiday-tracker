import { auth } from "@/auth";
import { Card } from "@/components/ui";
import { ProfileForm } from "./ProfileForm";

export default async function ProfilePage() {
  const session = await auth();
  return (
    <div className="space-y-6 max-w-md">
      <h1 className="text-2xl font-semibold">Profile</h1>
      <Card>
        <p className="text-sm"><span className="text-[var(--muted-foreground)]">Name:</span> {session?.user?.name}</p>
        <p className="text-sm"><span className="text-[var(--muted-foreground)]">Email:</span> {session?.user?.email}</p>
        <p className="text-sm"><span className="text-[var(--muted-foreground)]">Role:</span> {session?.user?.role}</p>
      </Card>
      <Card>
        <h2 className="mb-3 font-semibold">Change password</h2>
        <ProfileForm />
      </Card>
    </div>
  );
}
