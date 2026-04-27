import Image from "next/image";
import { LoginForm } from "./LoginForm";

export default function LoginPage() {
  return (
    <main className="min-h-screen flex items-center justify-center bg-[var(--muted)] px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-3">
          <Image
            src="/brand/pvcon-consulting-full.png"
            alt="PVCON Consulting"
            width={180}
            height={60}
            priority
          />
          <p className="text-sm text-[var(--muted-foreground)]">Holiday & Leave Tracker</p>
        </div>
        <div className="rounded-lg border border-[var(--border)] bg-white p-6 shadow-sm">
          <h1 className="mb-4 text-lg font-semibold">Sign in</h1>
          <LoginForm />
          <p className="mt-4 text-xs text-[var(--muted-foreground)]">
            Only @pvcon.in emails can access. Contact admin for credentials.
          </p>
        </div>
      </div>
    </main>
  );
}
