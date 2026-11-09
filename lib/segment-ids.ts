import { newId } from "./browser-safe";

// A duplicated prompt block gets its own id, made from the original's id, so it can still find the frame it was copied
// from (for its title, panel and join) without adding a frame.
const COPY_MARK = "~copy-";

export function duplicateSegmentId(id: string) {
  return `${baseSegmentId(id)}${COPY_MARK}${newId().slice(0, 8)}`;
}

export function baseSegmentId(id: string) {
  const at = id.indexOf(COPY_MARK);
  return at < 0 ? id : id.slice(0, at);
}

export function isDuplicateSegmentId(id: string) {
  return id.includes(COPY_MARK);
}

// The frame a segment belongs to: its own, or for a duplicate the one it was copied from.
export function frameFor<T extends { id: string }>(frames: T[], segmentId: string): T | undefined {
  return frames.find((frame) => frame.id === segmentId) ?? frames.find((frame) => frame.id === baseSegmentId(segmentId));
}

// The frame title, with "(copy)" for a duplicate; the fallback when there is no frame.
export function segmentTitle(frames: { id: string; title?: string }[], segmentId: string, fallback = segmentId) {
  const title = frameFor(frames, segmentId)?.title;
  if (!title) return fallback;
  return isDuplicateSegmentId(segmentId) ? `${title} (copy)` : title;
}
