# Handoff: add the "H3 Story V2" video workflow (with a DEV toggle) to the H3 Story Prompt Workshop app

Audience: a new Claude thread working in **`C:\myfiles\projects\my\h3-minimax-story-prompts-developer`** (the "H3 Story Prompt Workshop",
Next.js, port 48217). Read that repo's `AGENTS.md` first (this is a newer Next.js than you know: read `node_modules/next/dist/docs/` before
coding) and `README.md`. The workflow, mapping and an example of real injected values are attached next to this file in
`docs/h3_story_v2_workflow/` (copies; the source of truth is the other repo, see section 9).

## 0. The goal in one paragraph

The Workshop already turns a story gist into H3 Ref2VA prompts and already renders them as one **long take** through ComfyUI
(`comfy/h3-long-take-ref.json`, `lib/comfyui.ts` -> `queueLongTake`, `/api/video`, `/api/video/status`, and it already has a `devMode`
flag). The owner has a second app, **Themed Transformation Video Pipeline** ("H3 Stories V2", Python/FastAPI, port 48520), that renders
the same kind of story with a *different, newer ComfyUI workflow* (`h3_long_story_v2`: ref2va model, dual-pass render with a latent upscale,
every segment its own `ref` task, DEV/FULL switch, per-segment re-render). **Add that workflow to the Workshop as a second video engine**
(keep the existing long take working), selectable per render, with the same **DEV toggle**. Do not rebuild the story/prompt steps; only the
video engine (graph building, queueing, status, UI controls) and, optionally, the prompt deltas in section 6.

## 1. Files in `docs/h3_story_v2_workflow/` (give them all to the thread)

| file | what it is |
|---|---|
| `h3_long_story_v2.json` | **ComfyUI API-format graph** (POST it to `/prompt`). Contains a 6-segment sample `track_data` in node 29 that you replace. |
| `h3_long_story_v2.mapping.json` | role -> `{node_id, field}` list: exactly what the Pipeline app injects (section 3). `output` = node 25, media `video`. |
| `ui/h3_long_story_v2.json` | the same workflow as a **canvas (UI) template** to open in ComfyUI by hand (the Pipeline's "Export ComfyUI workflow" fills it). Not needed for API use. `ui/...widgets.json` is an empty stub. |
| `example_last_inputs.json` | the exact `values` the Pipeline injected for one real DEV render (5 segments, 20 s, 9:16): the **parity reference** for your graph builder (`track_data` is a JSON *string*). |
| `optional_ltx_refine/` | the LTX 2.5 "video detailer" graph + mapping the Pipeline runs after a FULL render (section 7). Optional, separate ComfyUI job. |

## 2. How the Pipeline uses MiniMax H3 here (what the workflow does)

`h3_long_story_v2` = ComfyUI's "H3 Long Story Playground": MiniMax H3 **reference-to-video** (`minimax_h3_ref2va_pruned_w4a8_mixed`),
Easy-Media multitrack (`easy multiTrackEditor` node 29 -> `easy multitrackProject` node 15 -> `easy multitrackProjectVideoCombine` node 17 ->
`easy saveVideo` node 25), `sampling_mode: dual`, `sampling_plan: light`:

1. **Pass 1** per segment at the chosen megapixels / steps (beta scheduler, euler, **Spectrum** node 51, **H3 SLA** node 39 `sage:auto`).
2. **Pass 2 refine**: latent upscale x1.25 (`minimax_h3_latent_upscaler_3d_conv_v1_fp16`) and ~4 steps (the "light" preset) using a **second
   model loader (node 52) without Spectrum** (`model_loader_2nd`). Spectrum on pass 2 crashes with an `aimdo memory compile error`: keep node 52 wired to node 39, not 51.
3. Segments render **one by one**; each finished clip is written to `ComfyUI/output/easy_media/projects/<project>/video_<n-1>_1.mp4` and its
   continuation state to `context_latent_<n-1>_1.safetensors` (that is what makes "re-render from segment N" possible). When all are done the
   clips are concatenated (node 17) and saved by node 25.
4. Output 24 fps, 9:16 by default (any Easy-Media aspect string, section 3).

**One reference image, every segment.** The story has ONE reference image (all characters together in the setting, calm/neutral). Every
segment is a task segment with `task_mode: "ref"` whose single image is that same picture (`<Picture 1>` in the prompt), marked
`shared_reference` (and `shared_reference_copy` on segments 2+), `ref_image_size: "match"`. Continuity between segments: the first segment
and every story "start/cut" join = `continuity_mode: "shot"` (fresh shot); a "continuous" join = `"context_swap"` (carries the previous segment's
ending over). The story itself decides which joins are continuous.

**DEV / FULL (the toggle you are adding).** Three **primitive** nodes feed everything that differs, through `ComfySwitchNode`s controlled by node 40
(`PrimitiveBoolean` "DEV MODE"):

| value | FULL (node 40 = false) | DEV (node 40 = true) | switch node |
|---|---|---|---|
| megapixels pass 1 | node 41 `PrimitiveFloat` | node 42 `PrimitiveFloat` | 43 -> `resolution.megapixels` of node 29 |
| steps pass 1 | node 48 `PrimitiveInt` | node 49 `PrimitiveInt` | 50 -> `BasicScheduler` node 22 |
| project folder | node 44 `PrimitiveString` | node 45 `PrimitiveString` | 46 -> `project_name` of node 15 |

The Pipeline's defaults: **both modes 0.3 MP / 10 steps** (megapixels move in 0.1 steps; Easy-Media would round 0.35 to 0.3), DEV project = `<base>_dev`,
FULL project = `<base>`. Because MP / steps / project name are **links**, never inject onto nodes 29/22/15 for those; set the primitives (the mapping does). DEV and FULL
use separate project folders on purpose so DEV context latents never feed a FULL "start from segment N".

## 3. The values to inject (roles in `h3_long_story_v2.mapping.json`)

| role | node.field | value |
|---|---|---|
| `track_data` | 29.`track_data` | JSON **string**, built as in section 4 |
| `aspect_ratio` | 29.`resolution.aspect_ratio` | one of Easy-Media's strings: `9:16 (Portrait Widescreen)`, `16:9 (Widescreen)`, `1:1 (Square)`, `2:3 (Portrait Photo)`, `3:2 (Photo)`, `3:4 (Portrait Standard)`, `4:3 (Standard)`, `21:9 (Ultrawide)`. Only 9:16 and 16:9 are proven in the Pipeline. |
| `dev_mode` | 40.`value` | bool |
| `megapixels` / `dev_megapixels` | 41 / 42.`value` | floats, 0.1 steps (Pipeline min 0.1, max 2.0) |
| `steps` / `dev_steps` | 48 / 49.`value` | ints (4-60) |
| `project_name` / `project_name_dev` | 44 / 45.`value` | `<base>` and `<base>_dev` (ComfyUI project folder names, `[A-Za-z0-9_-]`) |
| `project_save` | 15.`project_save` | `"override"` |
| `segment_start_number` / `segment_count` | 15.* | `1` / `-1` for a full render; e.g. `3` / `-1` re-renders segment 3 to the end, keeping earlier clips |
| `seed` | 15.`seed` | int (the Pipeline default is 343609390634740) |
| `project_data` | 17.`project_data` | JSON string `{"project_name": "<ACTIVE project>", "clips": [], "auto_combine": true}` where the active project is `<base>_dev` in DEV, `<base>` in FULL |

(The Workshop's current graph is different: its DEV switch is node 43 and it injects project names into 50/51; do not reuse those ids.)

## 4. Building `track_data` (port of `core/h3_v2.py::build_track_data` in the Pipeline repo)

Start from the template's `track_data` (node 29), keep everything, replace the `task` track's `segments`, empty every other track's `segments`, set
`total_length` (frames) and `frame_rate: 24`:

```ts
// segments: [{ durationSeconds, join: "start"|"continuous"|"cut", prompt }], imageName = file in ComfyUI/input (or output subfolder, see below)
let cursor = 0;
const taskSegments = segments.map((seg, i) => {
  const frames = Math.max(1, Math.round(seg.durationSeconds * 24));
  const image: any = { id: uuid(), source_type: "input", file_path: imageName, file_name: imageName,
                       shared_reference: true, ...(i > 0 ? { shared_reference_copy: true } : {}) };
  const entry = { id: uuid(), start_frame: cursor, end_frame: cursor + frames, color: "var(--multitrack-task-bg)",
    content: { media_type: "none", task_mode: "ref",
               continuity_mode: (i > 0 && seg.join === "continuous") ? "context_swap" : "shot",
               ref_image_size: "match", images: [image], muted: false, volume_db: 0, user_prompt: seg.prompt } };
  cursor += frames; return entry;
});
```

Notes: `source_type: "output"` with the file under ComfyUI's output folder also works (the Workshop already does this for its own graph; the Pipeline
uploads the picture to `ComfyUI/input` and uses `"input"`). If the picture is not shared by all segments the `shared_reference*` flags are omitted
(not your case: one image). **Parity check:** build the graph for the segments in `example_last_inputs.json` and compare your `track_data` with
its `track_data` after dropping every `id` field (uuids differ) -- they must be identical. The Python source of truth is `core/h3_v2.py`
(`build_track_data`, `video_values`) and `core/h3_pipeline.py::run_video` in the Pipeline repo.

## 5. Differences from the Workshop's current long take (so you know what changes)

| | Workshop `h3-long-take-ref.json` | Pipeline `h3_long_story_v2` |
|---|---|---|
| UNet | `minimax_h3_fl2va_pruned_w4a8_mixed` (first/last-frame model) | `minimax_h3_ref2va_pruned_w4a8_mixed` (reference model) |
| task per segment | seg 1 `ref`, later segments `edit` | **every** segment `ref`; continuity via `continuity_mode` |
| passes | single sampling, `sampling_plan: custom`, ManualSigmas 0.50..0.06 | `dual`, plan `light`, pass 2 = x1.25 latent upscale refine with a Spectrum-free 2nd loader (node 52) |
| DEV switch | node 43 (+ 44/45 steps, 47/48 MP, 50/51/52 project) | node 40 (+ 48/49 steps, 41/42 MP, 44/45/46 project) -- see section 2 table |
| canvas | `EmptyImage` + `ImageScaleToTotalPixels` from the reference image size | node 29 `resolution.aspect_ratio` + `resolution.megapixels` (no image-size probing needed) |
| extra | RTX VSR x1.075 after combine, a custom preview node | no VSR in the graph (the Pipeline runs RTX VSR / the LTX refine as *separate* later jobs) |
| projects | `<base>_dev` / `<base>_final` | `<base>_dev` / `<base>` |

So: new graph file + new queue function; the existing `queueLongTake`, its status route and its UI keep working. The status route can be reused
as is (same `video_<n>_1.mp4` polling, same node-25 output key) -- only pass the right project folder.

## 6. Prompt side (optional but recommended; verified vs not)

The Workshop's `prompts/h3-ref2va-system.md` is already a Ref2VA six-section prompt. What the Pipeline's V2 writer does differently
(`core/h3_ai.py` `_SEGMENT_SYSTEM_V2_REF`, `assemble_segment_prompt_v2`):

- **No timestamps at all** in V2 prompts (no `[Shot N] At 00:..` beats, no +0.92 s shifts). Verified by many real renders. **Not verified:** the
  timestamped prompts of the Workshop with this workflow -- test one before assuming they work.
- Continuous segments open with: "The video opens already in progress, continuing the exact same shot from the previous segment: same people, same
  place, same light, same camera framing." (a cut at ~20 s was seen without it).
- **A subject that is not in the shot is left out of that segment's prompt entirely** (its `subject_definitions` line, its `retention_analysis`
  line, and its name in the `<Picture 1> is the appearance anchor for ...` sentence). Reason found in a real render: a lion (dense dark-brown mane)
  defined in a segment before it appeared was drawn as a dark cave-like shape on the left that then persisted through the following continuous segments.
- The writer must also **name what fills the background on both sides of the frame** (tree trunks and sunlit foliage, walls, sky): an undefined dark area gets drawn.
- Staging first (who is where, left/right, near/far, facing), newcomers enter from a stated place and start small/far; one dominant action per beat, 2-3 beats;
  camera move with amplitude and speed; feelings only as visible action; no negative lists (they get drawn).
- Story plan shape: characters (stable ids, locked looks), setting, props, ONE reference-image description (everyone visible, calm), 3-9 segments of
  3-8 s (`action`, `join`, optional one dialogue line, always <= 1 line per segment). The Workshop's frames are 4-15 s: **segments over 8 s are untested
  with this workflow** -- keep a note and test before allowing 15 s.
- The owner's general H3 prompt rules are in `docs/MiniMax H3 Prompting Tips.md` (Pipeline repo) and, rephrased, in the Pipeline's Settings -> "Good-to-follow video prompt rules".

## 7. FULL = render + LTX refine (optional second job)

In the Pipeline, **FULL** means: render at the same 0.3 MP / 10 steps, then run the finished video through the LTX 2.5 "video detailer"
(`optional_ltx_refine/ltx25_video_detailer.json`, roles in its mapping: `video_file`, `frame_cap`, `frame_count`, `canvas_width/height`, `fps`, `prompt`, `seed`,
`filename_prefix`). Canvas ~0.9 MP (704x1280 for 9:16), frames cut to 8n+1 (449 of 450), H3's audio is wired straight into the result (the output node reports
`...-audio.mp4`; download that one). It keeps the take and adds detail; it cannot remove content H3 drew (fix the prompt and re-render that segment instead). The source video must be in
ComfyUI's `input` folder (upload it). Measured on a 16 GB GPU, 18.75 s story: DEV/FULL render 827 s, LTX refine 813-846 s, the old 0.5 MP / 20 steps FINAL 2011 s. If you skip this
section, "FULL" in the Workshop is just the render with the FULL values (still 0.3 MP / 10 steps by default; raise them if the owner wants a heavier render).

## 8. Facts and gotchas learned the hard way

- **One GPU.** Check `GET :8188/queue` before queueing; never restart ComfyUI while another job runs (it kills in-flight work).
- A **different megapixel/steps setting produces a different take** (puppy sitting vs standing in the same story). A DEV preview only previews the same settings; do not promise "preview = final".
- Timing (RTX 5060 Ti 16 GB): ~44 s of compute per output second at 0.3 MP / 10 steps (both modes), ~107 s at 0.5 MP / 20 steps, LTX refine ~43 s per output second. Learn rates from real runs for the estimate.
- Required custom nodes (ComfyUI install `C:\myfiles\VNCCS_Easy-Install\ComfyUI-Easy-Install`): `comfyui-easy-media` (multitrack nodes), `plaguekind-nodes/ComfyUI-H3-SLA-Attention` (`H3SLAAttention`), `comfyui-spectrum-minimax-h3` (`SpectrumApplyMiniMaxH3`), `comfyui-kjnodes` (`PathchSageAttentionKJ`, `ModelPreviewOverrideKJ`, uses `taeh3.safetensors`).
  Models: `minimax-h3/minimax_h3_ref2va_pruned_w4a8_mixed`, `minimax-h3/minimax_h3_audio_vae_fp32`, `minimax-h3/minimax_h3_video_vae_fp16`, `minimax-h3/minimax_h3_latent_upscaler_3d_conv_v1_fp16`, `qwen/qwen3vl_32b_minimax_h3_nvfp4_awq` (CLIP type `minimax`). Model storage: working set `C:\myfiles\all-comfy-models`, archive `E:\ml-apps\ai-assets\models` (copy from E: if missing).
- Don't "fix": pass 2 runs **without Spectrum** (node 52), DEV keeps the refine pass, SLA `dense_backend` stays `sage:auto` (the other backend crashes at step 0).
- Launchers: the default ComfyUI launcher (dynamic VRAM) is what the owner uses now; `Start ComfyUI H3 Stable.bat` exists because direct file->GPU streaming once failed with CUDA error 999.
  If ComfyUI **segfaults loading LTX models** (access violation in PyTorch), reboot the PC first (that fixed it once).
- Reference-image advice that held: ONE image with all characters standing apart, full body, calm, plain-ish background; a photo that shows the finished scene gets pasted into early frames. A photo in the video's aspect ratio is best (`ref_image_size: match`).
- A re-render of segments N..end needs `context_latent_<N-2>_1.safetensors` in that DEV/FULL project (a continuous segment continues from the saved end of the one before); otherwise start earlier.

## 9. Pointers into the Pipeline repo (`C:\myfiles\projects\my\Themed Transformation Video Pipeline`, read-only for you)

`CLAUDE.md` (short), `usage.md` section 5c (the full V2 guide), `core/h3_v2.py`, `core/h3_pipeline.py` (`run_video`, `_refine_with_ltx`), `core/h3_ltx_refine.py`,
`core/h3_ai.py` (V2 prompt writer), `workflows/h3_video_v2/`, `workflows/h3_ltx_refine/`. Do **not** edit that repo from this task, and do not run its server on port 48520 (the owner runs it).

## 10. Suggested plan for the Workshop thread

1. Copy `h3_long_story_v2.json` to the Workshop's `comfy/` (e.g. `comfy/h3-story-v2-ref2va.json`) and put the mapping (or a constants table of node ids from section 3) in `lib/comfyui.ts`.
2. Add `queueStoryV2({ segments, image, devMode, seed, megapixels, steps, aspectRatio, projectBase, startSegment?, segmentCount? })` that builds values per sections 3-4, sets primitives 40/41/42/48/49/44/45,
   `project_data` for the active project, and queues via the existing `queueWorkflow`. Keep `queueLongTake` unchanged.
3. `/api/video`: accept `engine: "long-take" | "story-v2"` (default stays long-take), plus `devMode`, `megapixels`, `steps`, `aspectRatio`, `seed`; validate durations for `story-v2` as 3-8 s unless the owner confirms longer; return `{ promptId, project }` as today.
4. UI: engine selector next to the existing DEV toggle; DEV/FULL radio with MP + steps fields (defaults 0.3 / 10); estimate text; optional "start from segment N" later.
5. Tests without a GPU: parity check of `track_data` against `example_last_inputs.json`; assert the graph's node 40/41/42/48/49/44/45 values and `project_data` for DEV and FULL; assert nothing is written to nodes 29's `resolution.megapixels`, 22's `steps`, 15's `project_name`.
6. One live test with the owner's go-ahead (GPU is shared): 2 short segments, DEV, 9:16; watch `video_0_1.mp4` appear and the final video from node 25. Report what you could not test.
7. Follow the Workshop's own conventions (its tab-status code, sticky note, ui prefs already exist there); commit in small steps; push only if asked.

## 11. Verified vs not verified (be honest in your report)

- Verified in the Pipeline by real GPU renders: the workflow and its track_data layout (all-`ref` segments, `context_swap`), DEV/FULL values, re-render from a segment, the prompts without timestamps, the LTX refine job.
- **Not verified:** running this workflow *from the Workshop* (nothing in the Workshop was changed by this handoff); the Workshop's timestamped prompts with this workflow; segments longer than 8 s; aspect ratios other than 9:16 / 16:9.

## 12. Acceptance

- Workshop can start a `story-v2` render with DEV on/off, shows progress via the existing status route, and saves the final video; the existing long take still works.
- The graph's DEV/FULL values and project folders are exactly as in section 2/3 (parity test passes); no GPU was used without the owner's go-ahead.
- A short report: what changed (files), what was tested (and how), what was not, commit ids.
