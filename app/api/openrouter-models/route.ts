import { NextResponse } from "next/server";
import { readCustomModels } from "@/lib/custom-models";
import { defaultModels } from "@/lib/openrouter";

export const dynamic = "force-dynamic";

// The .env default chain, for the model picker's "Currently: …" note (ids only, no key), and the models the owner added.
export async function GET() {
  const customModels = (await readCustomModels()).map(({ id, label }) => ({ id, label }));
  return NextResponse.json({ defaultModels: defaultModels(), customModels });
}
