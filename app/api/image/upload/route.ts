import { NextResponse } from "next/server";
import { uploadReferenceImage } from "@/lib/comfyui";

const MAX_BYTES = 25 * 1024 * 1024;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

// multipart: storyId + image (a PNG; the Image tab converts other formats first), optional
// stamp (yyyymmddhhmmss, shared by a grid and its panels) and suffix.
export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const storyId = String(form.get("storyId") || "");
    if (!/^[a-zA-Z0-9_-]+$/.test(storyId)) {
      return NextResponse.json({ error: "Missing story id." }, { status: 400 });
    }
    const file = form.get("image");
    if (!(file instanceof Blob) || file.size === 0) {
      return NextResponse.json({ error: "Choose an image to upload." }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: "The image is larger than 25 MB." }, { status: 400 });
    }
    const head = new Uint8Array(await file.slice(0, 8).arrayBuffer());
    if (!PNG_SIGNATURE.every((byte, index) => head[index] === byte)) {
      return NextResponse.json({ error: "The upload must be a PNG." }, { status: 400 });
    }
    // Panels cut from a storyboard grid carry a suffix (_p1, _p2, ...) after the grid's own name.
    const suffix = /^_[a-z0-9]{1,8}$/.test(String(form.get("suffix") || "")) ? String(form.get("suffix")) : "";
    const stamp = String(form.get("stamp") || "");
    const time = /^\d{14}$/.test(stamp) ? stamp : new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
    const filename = `upload_${time}${suffix}.png`;
    const image = await uploadReferenceImage(file, `h3-story/${storyId}`, filename);
    return NextResponse.json({ image });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Upload failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
