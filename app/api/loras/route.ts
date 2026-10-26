import { NextResponse } from "next/server";
import { listH3Loras } from "@/lib/comfyui";

export const dynamic = "force-dynamic";

// The H3 LoRAs in ComfyUI's models/loras/minimax-h3, scanned fresh for the LoRA popup. Speed (step /
// turbo) LoRAs are flagged: the workflows already carry their own, the popup is for enhancement LoRAs.
export async function GET() {
  try {
    const names = await listH3Loras();
    return NextResponse.json({
      loras: names.map((name) => ({
        name,
        label: name.replace(/^minimax-h3[\\/]/i, "").replace(/\.safetensors$/i, ""),
        speed: /turbo|\dstep|step_|_ckpt/i.test(name),
      })),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not list the LoRAs.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
