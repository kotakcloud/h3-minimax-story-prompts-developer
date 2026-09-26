"use client";

import { DebugLogFooter, DebugLogProvider } from "@/components/debug-log";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <DebugLogProvider>
      <div className="min-h-screen pb-12">{children}</div>
      <DebugLogFooter />
    </DebugLogProvider>
  );
}
