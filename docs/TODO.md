# Pending checks

## Cut-off lines in continuing segments (found 2026-11-10, not yet checked)

The owner sees lines cut off at the end of segments, and says raising a segment's duration by 1 s (e.g. 6 → 7) helps.

What the code shows (comfyui-easy-media, `nodes/project.py` ~1458–1475 and ~1953–1972):

- A continuing (`context_swap`) segment is generated with its length + 34 frames (about 1.42 s).
- `easy h3ContextMediaTrim` then drops the first 22 frames (the 0.92 s carried over from the previous segment), and
  cuts the result to the segment's own length, so the last 12 generated frames (**about 0.5 s, sound included**) are
  thrown away.
- The prompt timestamps (00:00.920 to duration + 0.920) map exactly onto what is kept, so the +0.92 s shift is right.
- H3 tends to run speech to the end of what it generates (see the "H3 speech fills the clip" findings), so a line
  that runs into that last 0.5 s is cut. Segment 1 and segments after a cut (`shot`) are not trimmed this way.

To check (no GPU needed): on existing takes, measure whether speech that is still loud at the segment end happens
mostly in continuing segments rather than in segment 1 / cut segments. Rendered segments are in
`ComfyUI/output/easy_media/projects/<project>/video_<n>_<gen>.mp4`.

Possible fixes if confirmed: tell the prompt the clip ends ~0.5 s before its last timestamp, or render continuing
segments slightly longer and trim them ourselves.
