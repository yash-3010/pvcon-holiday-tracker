import type { Metadata } from "next";
import Image from "next/image";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function VerifyLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-12">
      <div className="w-full max-w-md space-y-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <Image src="/brand/pvcon-logo-only.png" alt="PVCON" width={44} height={44} priority className="dark:hidden" />
          <Image src="/brand/pvcon-logo-inverted.png" alt="PVCON" width={44} height={44} priority className="hidden dark:block" />
          <p className="text-lg font-semibold text-primary">Payslip verification</p>
        </div>
        <div className="rounded-xl border bg-card p-6 shadow-xs">{children}</div>
      </div>
    </div>
  );
}
