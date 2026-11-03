import { NextResponse } from "next/server";
import { readStoryCost } from "@/lib/story-cost";

type RouteContext = { params: Promise<{ id: string }> };

// GET — what this story's AI calls have cost so far (null before its first counted call).
export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  return NextResponse.json({ cost: await readStoryCost(id) });
}
