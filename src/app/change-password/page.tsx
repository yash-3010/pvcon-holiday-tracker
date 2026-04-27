import { ChangePasswordForm } from "./ChangePasswordForm";

export default function ChangePasswordPage() {
  return (
    <main className="min-h-screen flex items-center justify-center bg-[var(--muted)] px-4">
      <div className="w-full max-w-sm rounded-lg border border-[var(--border)] bg-white p-6 shadow-sm">
        <h1 className="mb-2 text-lg font-semibold">Change Password</h1>
        <p className="mb-4 text-sm text-[var(--muted-foreground)]">
          You must set a new password before continuing.
        </p>
        <ChangePasswordForm />
      </div>
    </main>
  );
}
