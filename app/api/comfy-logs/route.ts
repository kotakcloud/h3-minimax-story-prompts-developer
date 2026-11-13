import { getLogs } from "@/features/comfy-log-viewer/server/handlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = getLogs;
