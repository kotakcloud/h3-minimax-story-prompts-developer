"use client";

import { DebugLogFooter, DebugLogProvider } from "@/components/debug-log";
import { TopBar } from "@/components/top-bar";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <DebugLogProvider>
      <TopBar />
      <div className="min-h-screen pt-[var(--nav-h)] pb-12">{children}</div>
      <DebugLogFooter />
    </DebugLogProvider>
  );
}
