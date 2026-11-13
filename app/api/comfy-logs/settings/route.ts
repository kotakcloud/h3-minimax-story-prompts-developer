import { getSettings, putSettings } from "@/features/comfy-log-viewer/server/handlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = getSettings;
export const PUT = putSettings;
