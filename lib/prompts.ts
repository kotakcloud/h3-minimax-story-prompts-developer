import { readFile } from "node:fs/promises";
import path from "node:path";

export async function readPrompt(relativePath: string): Promise<string> {
  return readFile(path.join(process.cwd(), relativePath), "utf8");
}
