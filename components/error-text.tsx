"use client";

import { useState } from "react";

// An error message: its first line, and the rest (when the server sent details, like the AI provider's own answer)
// behind "Details".
export function ErrorText({ message, className = "" }: { message: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const [head, ...rest] = message.split("\n");
  const details = rest.join("\n").trim();
  return (
    <div className={`rounded-xl border border-red-900/60 bg-red-950/40 px-4 py-3 text-sm text-red-200 ${className}`}>
      <p className="break-words">
        {head}
        {details && (
          <button type="button" onClick={() => setOpen(!open)} className="ml-2 text-xs text-red-300 underline underline-offset-2">
            {open ? "Hide details" : "Details"}
          </button>
        )}
      </p>
      {open && details && (
        <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-black/30 p-2 font-mono text-xs text-red-100">
          {details}
        </pre>
      )}
    </div>
  );
}
