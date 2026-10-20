import { NextResponse } from "next/server";
import { defaultModels } from "@/lib/openrouter";

export const dynamic = "force-dynamic";

// The .env default chain, for the model picker's "Currently: …" note (ids only, no key).
export async function GET() {
  return NextResponse.json({ defaultModels: defaultModels() });
}
