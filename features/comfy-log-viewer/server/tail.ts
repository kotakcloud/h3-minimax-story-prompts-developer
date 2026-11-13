import { open } from "node:fs/promises";

const CHUNK_BYTES = 64 * 1024;
const MAX_BYTES = 8 * 1024 * 1024; // never hold more than this, however long the log's lines are
const NEWLINE = 0x0a;
const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;

// ComfyUI's log keeps terminal colours, and progress bars redraw themselves with \r: show what a terminal would.
function cleanLine(line: string) {
  const parts = line.replace(ANSI, "").replace(/\r+$/, "").split("\r");
  return parts[parts.length - 1];
}

// The last `count` lines of a file, reading backwards from the end in chunks, so a huge log is never loaded whole.
export async function readTail(file: string, count: number): Promise<string[]> {
  const handle = await open(file, "r");
  try {
    const stats = await handle.stat();
    // Windows opens a folder without complaint and reports size 0, which would look like an empty log
    if (!stats.isFile()) throw Object.assign(new Error(`Not a file: ${file}`), { code: "EISDIR" });
    const { size } = stats;
    const chunks: Buffer[] = [];
    let position = size;
    let total = 0;
    let newlines = 0;
    // count + 1 newlines: the last line's own, and the one before the first line wanted
    while (position > 0 && newlines <= count && total < MAX_BYTES) {
      const length = Math.min(CHUNK_BYTES, position);
      position -= length;
      const buffer = Buffer.allocUnsafe(length);
      const { bytesRead } = await handle.read(buffer, 0, length, position);
      if (!bytesRead) break; // the file shrank while reading
      const chunk = buffer.subarray(0, bytesRead);
      chunks.unshift(chunk);
      total += bytesRead;
      for (const byte of chunk) if (byte === NEWLINE) newlines++;
    }
    let data = Buffer.concat(chunks);
    if (position > 0) {
      // Reading stopped mid-file: drop the partial first line (splitting on the newline byte never cuts a UTF-8 character).
      const first = data.indexOf(NEWLINE);
      if (first >= 0) data = data.subarray(first + 1);
    }
    const lines = data.toString("utf8").split("\n");
    if (lines[lines.length - 1] === "") lines.pop();
    return lines.slice(-count).map(cleanLine);
  } finally {
    await handle.close();
  }
}
