import { execFile } from "node:child_process";
import { access, copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { comfyViewUrl } from "./comfyui";

const run = promisify(execFile);
const FFMPEG = process.env.FFMPEG_PATH || "ffmpeg";
const FFPROBE = process.env.FFPROBE_PATH || "ffprobe";
const FONT = process.env.COMPARE_FONT || "C:/Windows/Fonts/arial.ttf";

// Side-by-side comparisons live in the app's own data folder (not ComfyUI's), one file per comparison.
export function comparisonDir(storyId: string): string {
  if (!/^[a-zA-Z0-9_-]+$/.test(storyId)) throw new Error("Invalid story id.");
  return path.join(process.cwd(), "data", "comparisons", storyId);
}

export function comparisonFile(storyId: string, id: string): string {
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error("Invalid comparison id.");
  return path.join(comparisonDir(storyId), `${id}.mp4`);
}

export type CompareTile = {
  video: { filename: string; subfolder: string; type: string };
  lines: string[];
};

// COMFYUI_OUTPUT_DIR (optional): ComfyUI's output folder on this machine.
async function localOutputFile(video: CompareTile["video"]): Promise<string | null> {
  const root = process.env.COMFYUI_OUTPUT_DIR;
  if (!root || video.type !== "output" || video.subfolder.includes("..") || /[\\/]/.test(video.filename)) return null;
  const file = path.join(root, ...video.subfolder.split(/[\\/]+/).filter(Boolean), video.filename);
  return access(file).then(
    () => file,
    () => null,
  );
}

type Probe = { width: number; height: number; duration: number; audio: boolean };

async function probe(file: string): Promise<Probe> {
  const { stdout } = await run(FFPROBE, [
    "-v", "error", "-show_entries", "stream=codec_type,width,height:format=duration", "-of", "json", file,
  ]);
  const data = JSON.parse(stdout) as { streams?: { codec_type?: string; width?: number; height?: number }[]; format?: { duration?: string } };
  const video = data.streams?.find((stream) => stream.codec_type === "video");
  return {
    width: video?.width || 0,
    height: video?.height || 0,
    duration: Number(data.format?.duration) || 0,
    audio: Boolean(data.streams?.some((stream) => stream.codec_type === "audio")),
  };
}

// Stitches 2-4 finished videos: side by side (2-3) or 2x2 (4), each tile under a header with its label lines;
// shorter clips hold their last frame until the longest ends. Audio comes from tile `audioFrom`.
export async function stitchComparison(
  storyId: string,
  id: string,
  tiles: CompareTile[],
  audioFrom: number,
): Promise<{ duration: number; width: number; height: number }> {
  if (tiles.length < 2 || tiles.length > 4) throw new Error("Compare 2 to 4 videos.");
  const work = await mkdtemp(path.join(os.tmpdir(), "h3-compare-"));
  try {
    // ffmpeg runs inside `work`, so the font and label files need no drive-letter escaping in the filter.
    await copyFile(FONT, path.join(work, "font.ttf"));
    const probes: Probe[] = [];
    for (const [index, tile] of tiles.entries()) {
      // Straight from ComfyUI's output folder when the app knows it (much faster than ComfyUI's /view for big
      // files), else over HTTP.
      const local = await localOutputFile(tile.video);
      if (local) {
        await copyFile(local, path.join(work, `in${index}.mp4`));
      } else {
        const response = await fetch(comfyViewUrl(tile.video));
        if (!response.ok) throw new Error(`ComfyUI could not return video ${index + 1} (${response.status}).`);
        await writeFile(path.join(work, `in${index}.mp4`), Buffer.from(await response.arrayBuffer()));
      }
      probes.push(await probe(path.join(work, `in${index}.mp4`)));
      const text = tile.lines.map((line) => line.replace(/[\u0000-\u001f]/g, " ").slice(0, 120)).join("\n");
      await writeFile(path.join(work, `label${index}.txt`), text, "utf8");
    }

    const longest = Math.max(...probes.map((item) => item.duration));
    const tileHeight = Math.max(360, Math.min(720, ...probes.map((item) => item.height)));
    const lineCount = Math.max(...tiles.map((tile) => tile.lines.length), 1);
    const parts: string[] = [];
    const sizes: { w: number; h: number }[] = [];
    probes.forEach((item, index) => {
      const width = Math.round((tileHeight * item.width) / item.height / 2) * 2;
      const fontSize = Math.max(13, Math.min(22, Math.round(width / 34)));
      const header = 14 + lineCount * Math.round(fontSize * 1.45);
      sizes.push({ w: width, h: tileHeight + header });
      parts.push(
        `[${index}:v]scale=${width}:${tileHeight},setsar=1,fps=24,` +
          `tpad=stop_mode=clone:stop_duration=${Math.max(0, longest - item.duration).toFixed(3)},` +
          `pad=iw:ih+${header}:0:${header}:color=0x111110,` +
          `drawtext=fontfile=font.ttf:textfile=label${index}.txt:fontcolor=0xf3eee4:fontsize=${fontSize}:x=10:y=8:line_spacing=${Math.round(fontSize * 0.45)}` +
          `[v${index}]`,
      );
    });
    // Tiles share a height (headers can differ only by font size): pad them all to the tallest.
    const tallest = Math.max(...sizes.map((size) => size.h));
    probes.forEach((_, index) => parts.push(`[v${index}]pad=iw:${tallest}:0:0:color=0x111110,pad=iw+4:ih:0:0:color=0x2d2b26[t${index}]`));
    const inputs = probes.map((_, index) => `[t${index}]`).join("");
    if (tiles.length === 4) {
      parts.push(`${inputs}xstack=inputs=4:layout=0_0|w0_0|0_h0|w0_h0:fill=0x111110[vout]`);
    } else {
      parts.push(`${inputs}hstack=inputs=${tiles.length}[vout]`);
    }
    const audioIndex = Math.min(Math.max(0, audioFrom), tiles.length - 1);
    const withAudio = probes[audioIndex].audio;
    if (withAudio) parts.push(`[${audioIndex}:a]apad[aout]`);

    const output = comparisonFile(storyId, id);
    await mkdir(path.dirname(output), { recursive: true });
    const args = [
      "-y", "-v", "error",
      ...probes.flatMap((_, index) => ["-i", `in${index}.mp4`]),
      "-filter_complex", parts.join(";"),
      "-map", "[vout]",
      ...(withAudio ? ["-map", "[aout]", "-c:a", "aac", "-b:a", "160k"] : []),
      "-t", longest.toFixed(3),
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p",
      "-movflags", "+faststart",
      output,
    ];
    await run(FFMPEG, args, { cwd: work, maxBuffer: 16 * 1024 * 1024 });
    const result = await probe(output);
    return { duration: result.duration, width: result.width, height: result.height };
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}
