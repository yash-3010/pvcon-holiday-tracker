import Image from "next/image";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-12">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <Image src="/brand/pvcon-logo-only.png" alt="PVCON" width={44} height={44} priority className="dark:hidden" />
          <Image src="/brand/pvcon-logo-inverted.png" alt="PVCON" width={44} height={44} priority className="hidden dark:block" />
          <div>
            <p className="text-lg font-semibold text-primary">PVCON People</p>
            <p className="text-sm text-muted-foreground">HR, time and payroll</p>
          </div>
        </div>
        <div className="rounded-xl border bg-card p-6 shadow-xs">{children}</div>
      </div>
    </div>
  );
}
