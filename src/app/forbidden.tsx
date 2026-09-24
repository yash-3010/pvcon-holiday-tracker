import Link from "next/link";
import { Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

export default function Forbidden() {
  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <EmptyState
        icon={Lock}
        title="You don't have access to this page"
        description="Ask an administrator if you think you should."
        action={
          <Button asChild variant="outline">
            <Link href="/">Back to dashboard</Link>
          </Button>
        }
      />
    </div>
  );
}
