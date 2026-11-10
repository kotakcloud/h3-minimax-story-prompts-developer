import { execFile } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { comfyViewUrl, localOutputFile, type ComfyImage } from "./comfyui";
import { probe } from "./compare";

// Joining stories: the last frame of one story's take as a picture for another story's segment, and two takes from
// (usually) two stories played one after the other as one video.

const run = promisify(execFile);
const FFMPEG = process.env.FFMPEG_PATH || "ffmpeg";

// Joined videos live in the app's own data folder (not ComfyUI's), one file per join, under the story that made it.
export function joinDir(storyId: string): string {
  if (!/^[a-zA-Z0-9_-]+$/.test(storyId)) throw new Error("Invalid story id.");
  return path.join(process.cwd(), "data", "joins", storyId);
}

export function joinFile(storyId: string, id: string): string {
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error("Invalid join id.");
  return path.join(joinDir(storyId), `${id}.mp4`);
}

// A finished video from ComfyUI's output folder, copied into `target` (straight from disk when the app knows the
// folder, else over HTTP).
async function fetchVideo(video: ComfyImage, target: string) {
  const local = await localOutputFile(video);
  if (local) {
    await copyFile(local, target);
    return;
  }
  const response = await fetch(comfyViewUrl(video));
  if (!response.ok) throw new Error(`ComfyUI could not return the video (${response.status}).`);
  await writeFile(target, Buffer.from(await response.arrayBuffer()));
}

// The very last frame of a video, as PNG bytes.
export async function lastFrame(video: ComfyImage): Promise<Buffer> {
  const work = await mkdtemp(path.join(os.tmpdir(), "h3-lastframe-"));
  try {
    await fetchVideo(video, path.join(work, "in.mp4"));
    // Seek close to the end and keep overwriting one image: the file ends up holding the final frame.
    await run(FFMPEG, ["-y", "-v", "error", "-sseof", "-1", "-i", "in.mp4", "-update", "1", "-frames:v", "100", "last.png"], {
      cwd: work,
      maxBuffer: 16 * 1024 * 1024,
    });
    return await readFile(path.join(work, "last.png"));
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

// Plays the takes one after another as one video, at the first take's size (others are scaled to fit, with bars if
// their shape differs) and 24 fps. A take without sound gets silence, so the sound stays in step.
export async function joinVideos(
  storyId: string,
  id: string,
  videos: ComfyImage[],
): Promise<{ duration: number; width: number; height: number }> {
  if (videos.length < 2 || videos.length > 4) throw new Error("Join 2 to 4 videos.");
  const work = await mkdtemp(path.join(os.tmpdir(), "h3-join-"));
  try {
    const probes = [];
    for (const [index, video] of videos.entries()) {
      await fetchVideo(video, path.join(work, `in${index}.mp4`));
      probes.push(await probe(path.join(work, `in${index}.mp4`)));
    }
    const width = Math.round(probes[0].width / 2) * 2 || 1280;
    const height = Math.round(probes[0].height / 2) * 2 || 720;
    const withAudio = probes.some((item) => item.audio);
    const parts: string[] = [];
    probes.forEach((item, index) => {
      parts.push(
        `[${index}:v]scale=${width}:${height}:force_original_aspect_ratio=decrease,` +
          `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=24,format=yuv420p[v${index}]`,
      );
      if (withAudio) {
        parts.push(
          item.audio
            ? `[${index}:a]aresample=48000,aformat=channel_layouts=stereo,apad,atrim=duration=${item.duration.toFixed(3)}[a${index}]`
            : `anullsrc=r=48000:cl=stereo,atrim=duration=${item.duration.toFixed(3)}[a${index}]`,
        );
      }
    });
    const inputs = probes.map((_, index) => (withAudio ? `[v${index}][a${index}]` : `[v${index}]`)).join("");
    parts.push(`${inputs}concat=n=${probes.length}:v=1:a=${withAudio ? 1 : 0}${withAudio ? "[vout][aout]" : "[vout]"}`);

    const output = joinFile(storyId, id);
    await mkdir(path.dirname(output), { recursive: true });
    await run(
      FFMPEG,
      [
        "-y", "-v", "error",
        ...probes.flatMap((_, index) => ["-i", `in${index}.mp4`]),
        "-filter_complex", parts.join(";"),
        "-map", "[vout]",
        ...(withAudio ? ["-map", "[aout]", "-c:a", "aac", "-b:a", "160k"] : []),
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p",
        "-movflags", "+faststart",
        output,
      ],
      { cwd: work, maxBuffer: 16 * 1024 * 1024 },
    );
    const result = await probe(output);
    return { duration: result.duration, width: result.width, height: result.height };
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}
