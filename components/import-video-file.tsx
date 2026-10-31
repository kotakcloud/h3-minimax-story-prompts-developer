"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { useLoggedFetch } from "@/components/debug-log";
import { storyPath } from "@/lib/types";

// Picks an exported video file and opens the Video-only story it becomes. Nothing renders until Generate video.
export function ImportVideoFile({ onError, className }: { onError: (message: string) => void; className?: string }) {
  const router = useRouter();
  const request = useLoggedFetch();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function importFile(file: File) {
    setBusy(true);
    onError("");
    try {
      const response = await request(`/api/video-package?name=${encodeURIComponent(file.name)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: file,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not import the file.");
      router.push(storyPath(data.story.id, "video"));
    } catch (err) {
      onError(err instanceof Error ? err.message : "Could not import the file.");
      setBusy(false);
    }
  }

  return (
    <>
      <input
        ref={input}
        type="file"
        accept=".json,application/json"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void importFile(file);
        }}
      />
      <button
        type="button"
        onClick={() => input.current?.click()}
        disabled={busy}
        className={className ?? "rounded-full border border-line px-4 py-1.5 text-sm text-foreground disabled:opacity-50"}
      >
        {busy ? "Importing…" : "Import video file"}
      </button>
    </>
  );
}
