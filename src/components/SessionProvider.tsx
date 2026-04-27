"use client";
import { SessionProvider as NASessionProvider } from "next-auth/react";

export function SessionProvider({ children }: { children: React.ReactNode }) {
  return <NASessionProvider>{children}</NASessionProvider>;
}
