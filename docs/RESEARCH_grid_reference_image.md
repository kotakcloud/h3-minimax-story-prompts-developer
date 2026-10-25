# Research: one uploaded image that is a grid of scenes (storyboard) as the H3 reference

Date: 2026-10-25. Status: research + one A/B render test (section 6); nothing implemented in the app yet. Question from the owner: if the uploaded reference picture is a
**grid of scenes** (marked with a checkbox at upload), what else has to change in the later steps so MiniMax H3 follows it,
scene by scene, when the prompts and the video are generated?

## 1. Short answer

H3 Ref2VA supports this officially: a reference image may be a **storyboard** (`<Picture N>` as a shot-planning anchor), and
community tests report that H3 follows storyboards well. But the Workshop today treats its one image as an *appearance
anchor* ("everyone in the place, calm"), takes the **video's aspect ratio from that image**, shrinks it to the canvas
(`ref_image_size: match` in Story V2), always **continues** every segment (no cuts), and its AI steps are **text-only**
(no model ever looks at the picture). Each of those breaks or weakens a grid. The changes below fix that; two of them
need a short A/B render test before choosing (section 5).

## 2. What the sources say (evidence)

**MiniMax's own full-reference rewrite guide** (shipped in Easy-Media as `utils/prompt_builder.py` -> `MINIMAX_REF_PROMPT`,
same text as `skills/minimax-h3-prompt-agentskill/references/ref2va-format.md`):
- `<Picture N>` is "a reference image used as a concrete target frame **or shot-planning anchor**"; an image that only
  defines a character/scene/style gets **no** `<Picture N>` line, it is cited inside the `<Subject N>` line.
- Storyboard wording, verbatim: `<Picture 3> is a storyboard reference for [Shot 1] and [Shot 2], defining their viewpoint,
  subject placement, and shot order.`
- Task prefix for a storyboard is `[reference generation]` (not `[keyframe completion]`, which is for first/last/key frames).
- MiniMaxH3-Director (installed) adds: H3's Qwen3-VL text encoder "was trained on exactly this notation", and its
  "storyboard" image role writes the same sentence per shot.

**Easy-Media code** (`comfyui-easy-media`, installed, the multitrack nodes all our ref workflows use):
- Up to **9 reference images per segment** (`MAX_REF_IMAGES = 9`), mapped in list order to `<Picture 1..N>`; a
  `shared_reference` image is added once.
- `ref_image_size`: `match` scales the reference down to the **video canvas pixel count** (DEV 544x960 = 0.52 MP);
  `max` keeps it up to a **2048 px short edge**. With `match`, each panel of a 3x3 grid gets ~0.06 MP: too small to read.
- A segment image has no crop option: per-panel use means uploading cut-out panel files.

**Community reports** (third-party, not measured by us):
- RunDiffusion guide: use reference mode (not start frame) for storyboards; say what the storyboard controls ("Image 4 is a
  storyboard reference for Shots 1, 2, and 3"), limit it to shot order / viewpoint / placement / framing; a sheet can put
  the cast row on top and the sequence below, with a region-mapping sentence; pitfalls: "storyboard skipped or merged" when
  the prompt competes with it or the duration is too short; "sheet dominates the opening" when used as a start frame.
- ai-flow.net template (4-panel, 5 s): "Image 1 is a four-panel storyboard reference ... NOT a first frame ... each panel
  represents one successive live-action shot", and that the grid, borders, captions, panel numbers and white page must
  never appear.
- Virse.ai: one grid for a ~10-15 s sequence works for prototyping; **panel-order accuracy and reading small text in panels
  are not guaranteed**; keep one role per reference (character image = identity, storyboard = composition); 0.4 MP showed
  stronger adherence than 0.9 MP in one test; split groups where continuity breaks.
- Kōda (X): storyboards "work incredibly well" with H3, with no scene descriptions in the prompt at all.

## 3. Two ways to feed a grid to H3

| | A. Whole grid as `<Picture 1>` on every segment | B. Cut panels: segment k gets panel k |
|---|---|---|
| How | Upload as today; segment prompts say which panel(s) it plays | At upload, split the grid into panel PNGs (browser canvas, like the PNG conversion we already do) and upload them too |
| Prompt | `<Picture 1> is a storyboard reference for [Shot 1] ..., panel 3 (top row, right)` | `<Picture 1> is the storyboard frame for [Shot 1]: its viewpoint, subject placement and framing` |
| Identity | Whole grid helps keep faces/clothes consistent across panels | Add the full grid (or a cast panel) as `<Picture 2>`/subject source for identity |
| Risk | Model reproduces the grid layout or picks the wrong panel; small panels | Each segment sees only one composition; needs per-segment images (not `shared_reference`) |
| Code | Small | Medium (cropping, per-segment track images) |

Recommendation: implement **A first** (it is what the sources describe and what H3 was trained on), with `ref_image_size:
max`, and keep **B** as the fallback if the A/B test (section 5) shows grid artifacts or wrong panels. Both need the
changes in section 4.

## 4. What to change, step by step

### 4.1 Upload (Image tab)
- Checkbox **"This is a storyboard grid"** + rows x columns (default auto-guess from the picture: 2x2, 2x3, 3x3) +
  reading order (left-to-right, top-to-bottom) + optional "first row is the cast" (RunDiffusion's sheet layout).
- Store on the reference image: `kind: "grid"`, `rows`, `cols`, `order`, `castRow`. For option B also store the panel
  crops (each uploaded like today's uploads, `h3-story/<id>/upload_<time>_p<k>.png`).
- Advise the owner in the UI: clean panels, **no captions or panel numbers** (H3 draws text as pseudo-letters and the
  Workshop's prompts forbid on-screen text), same characters in every panel, panel aspect = intended video aspect.

### 4.2 A vision step: "Read the grid" (new; nothing in the Workshop looks at images today)
- `lib/openrouter.ts` only sends text. Add image input (OpenRouter `content: [{type: "text"}, {type: "image_url"}]`,
  base64 of the PNG fetched from ComfyUI). Needs an image-capable model: `google/gemini-3.7-flash` (the recommended
  default) is; the `.env` default deepseek-v4-flash is **not**, so block the step or switch models when the story's model
  cannot see images.
- One call per grid returns JSON: per panel {who is visible, positions left/right/near/far, framing (wide/medium/close),
  camera angle, action, setting details, any visible text}; plus character looks and the setting.
- Use it to (a) prefill or check the **Cast** (looks come from the grid instead of being invented), (b) write the
  **layout** text per panel (today's `imageLayout` is one sentence for one picture), (c) create the **frames** (4.3).
  Store the result on the story so later steps stay text-only and cheap.

### 4.3 Frames
- One frame per panel (or the analysis beats mapped onto panels, if a gist exists). Frame gets `panel: number`
  (1-based, reading order) and its **join** to the previous frame: `cut` (new shot) or `continuous`.
- A grid of *scenes* mostly means **cuts**. Today every segment after the first is forced to continue the take
  (`context_swap` + "already in progress" opener). Add the per-frame join, default `cut` for grid stories.
- Durations: each panel is one beat, so 4-6 s per panel (H3's minimum clip is 4 s); merge two panels into one segment
  (two `[Shot N]`s) only when the engine allows cuts inside a segment (see 4.4).

### 4.4 Prompts (new prompt mode, or a grid variant of each style)
- `subject_definitions`: `<Subject N>` lines cite the grid as the appearance source ("the man in the light blue shirt
  shown in the panels of `<Picture 1>`"), plus one `<Picture 1>` line: **storyboard reference** for this segment's
  shot(s), naming the panel by position ("panel 3, top row right"), defining viewpoint, subject placement and framing.
- `summary` prefix `[reference generation]`; `retention_analysis` line for `<Picture 1>` as the storyboard (composition
  and shot order), not "fully preserved appearance anchor".
- Let the panel carry composition; the prompt carries motion, camera move, timing, dialogue, sound (Virse.ai,
  RunDiffusion). Keep prompts shorter than today's 350-500 words so they do not "compete" with the board.
- Say the video is one full-frame live-action shot of that panel's moment. **Conflict to test**: ai-flow says to forbid
  grid/borders/numbers explicitly, but our own rule (from real renders) is "no negative lists, they get drawn" and "never
  mention text". Default to the positive wording; test the explicit sentence only if borders appear.
- Join handling: `cut` segments open as a fresh shot that matches their panel (no "already in progress" opener);
  `continuous` keep today's opener. Story V2 style forbids cuts inside a segment, so one panel per segment there.
- Prompt-writer context: pass the per-panel descriptions from 4.2 (and the panel number) instead of the one-line layout.
- Update the validation checks: the undefined-subject retry, opener insertion and timestamp checks must respect `cut`.

### 4.5 Video
- **Canvas aspect**: today it comes from the reference image (`aspectRatio: image.aspectRatio`; the long take even reads
  the PNG size). A 2x2 grid of 9:16 panels is ~9:16 again, but a 3x2 grid of 16:9 panels is 8:3. Add a **video aspect
  ratio** setting: for grids default to the panel's aspect ratio (cell width/height), not the grid's.
- **`ref_image_size: max`** for grids (Story V2 hard-codes `match`; Veda/Sage templates already use `max`). With
  option B, `match` is fine for a single panel.
- **Track data**: per-segment `continuity_mode` from the frame's join (`cut` -> `shot`, `continuous` -> `context_swap`);
  option B: per-segment images (panel k, not `shared_reference`) plus the shared full grid if used for identity.
- **Engines**: allow grids on Story V2 / Veda Turbo / Sage SLA (all ref2va). Block or warn on the **long take** (fl2va,
  later segments are `edit` tasks continuing the previous one; it was never designed for scene cuts).
- Warnings: more than 9 panels (one image per segment is fine, but long boards drift), panel text detected by 4.2,
  segments over 8 s on Story V2 (existing warning).

### 4.6 Smaller follow-ups
- Export (JSON / Markdown) should carry the panel number per segment.
- Video list details: show "Storyboard grid 2x2, option A/B".
- README: a "Storyboard grids" section with the do's and don'ts above.

## 5. Tests to run before committing to a design (GPU, owner's go-ahead)
1. A clean **2x2 grid** (4 panels, 9:16 panels, no text), 4 segments of 5 s, Veda Turbo DEV.
2. Option **A** with `max` vs option **B** (panel per segment) at the same seed; then A with `match` to confirm it is worse.
3. Check: grid borders or multiple panels visible in any frame; each segment matches its panel (framing, who is where);
   faces/clothes stable across cuts; panel order respected; cuts clean (`shot`) vs continuous joins.
4. If A shows borders: add the explicit "storyboard is planning only" sentence (4.4) and retest before falling back to B.
5. One 3x3 grid run to see where panel size starts to hurt (sources: no verified panel limit).

## 6. A/B test result (2026-10-25, run on the owner's go-ahead)

**Setup.** Grid built from four consecutive Flux.2 Klein 9B scenes of "The Last Coin" (story-scene-prompter render
`2026-10-25T10-23-18-219Z`, scenes 2, 3, 7, 8: boy at the window / coin in his palm / old man gives him the cake / boy
runs home): a clean 2x2 grid, 1344x768 (16:9) panels, 16 px white gutters and margin, no captions -> 2736x1584. Veda
Turbo DEV (960x544, 4 steps), 16:9, seed 907327329980779, four 5 s segments, every join a **cut** (`continuity_mode:
shot`), `ref_image_size: max`, hand-written six-section prompts identical in A and B except the `<Picture 1>` lines:
- **A** = the whole grid as `<Picture 1>` on every segment (shared reference): `<Picture 1> is a storyboard reference
  for [Shot 1]: its top-left panel defines this shot's viewpoint, framing, subject placement, light and setting.`
  (top-right / bottom-left / bottom-right for segments 2-4), retention `partially_preserved - only the <pos> panel's
  composition ... the video is one full-frame shot.`
- **B** = segment k gets only panel k: `<Picture 1> is the storyboard frame for [Shot 1], defining its viewpoint,
  framing, subject placement, light and setting.`
No negative wording about borders or grids in either.

**Result.** Both finished (A `easy_media/projects/gridab_a_dev/out/gridab_a_dev_00001_.mp4`, B `.../gridab_b_dev/...`,
both 960x544, 20.7 s, with audio). Frames at the start, middle and end of every segment:
- **A picked the right panel every time** from its position name; each segment opens on that panel's composition
  (window left / boy right, coin close-up, boy + old man with the cake box, boy running down the street) and then plays
  the written action.
- **No grid artifacts** in A or B: no gutters, borders, neighbouring panels or white page in any frame; every shot is
  full-frame. The explicit "never show the grid" sentence (ai-flow) was not needed.
- Identity (boy's hair and denim jacket, the old man's cap and coat) stays consistent across the cuts in both.
- A and B look almost the same (same seed). **B was faster: 431 s vs 671 s** (each segment encodes one 1344x768 panel
  instead of the 2736x1584 grid).
- Panels act close to a **first frame**: each segment starts on its panel, then moves. Good for "cut" joins; a
  `continuous` join with a different panel would jump, so continuous joins should keep the previous panel or use none.

**Decision.** Implement **option A** as the default (one upload, no cropping, the prompt names the panel by position) and
keep **option B** as a speed option for large grids or slow renders (crop at upload; same prompts with the panel line).
`ref_image_size: max` and per-segment **cut** joins are required either way. Not tested: audio/dialogue (not listened
to), 3x3 grids, grids with captions, FULL mode, Story V2 (dual pass) with a grid, prompts written by the LLM instead of
by hand. Test files: the grid and panels in ComfyUI `output/h3-story/gridab/`, the script in this session's scratchpad.

### 6b. Through the app (2026-10-25, after implementing it)
Story "[Grid test] The Last Coin" (24ef3f94): the same 2x2 grid uploaded as a storyboard, **Frames from grid**
(gemini-3.7-flash, 13 s: one frame per panel, all cuts, character looks read from the panels), Story V2 prompts with the
storyboard lines, **Generate video** clicked in the app: Veda Turbo DEV, whole-grid feed, 5+5+7+6 s. Done in 736 s,
23.5 s 960x544 with audio (`easy_media/projects/h3s_24ef3f94_veda_dev/out/`). Every segment opens on its panel (window,
coin close-up, old man with the cake box, boy running down the street), no grid artifacts, and the boy's denim jacket and
the old man's cap and coat match the grid. Not checked: the spoken lines (audio not listened to).

### 6c. Gujarati version (Language version, 2026-10-26)
Prompt set 3 = set 2 with only the spoken line translated (`<d>[Gujarati] ખૂબ ખૂબ આભાર દાદા! મારી મમ્મી બહુ ખુશ થઈ જશે!</d>`),
rendered from the app with the same seed and settings (751 s, `..._00002_.mp4`). Segments 1, 2 and 4 are pixel-identical to
the English run (their prompts did not change); segment 3 keeps the scene but shifts pose and framing a little.
faster-whisper large-v3 on the two segment-3 clips: English "Thank you, Grandpa. My mother will be so happy."; Gujarati
(forced) "ખુબ ખુબ આભર દાદા મારી મમ્મી બહું ખુશ થઇ જશે", the same sentence. Auto-detect guessed Hindi (0.67) but wrote the
same Gujarati words in Devanagari, so the detector, not the speech, is unsure.

## 7. Not verified
Beyond section 6: the community claims are third-party and unmeasured; panel-order accuracy on bigger boards, behaviour
with captions in panels, and the best per-panel duration are still open.

## Sources
- MiniMax full-reference rewrite guide, in `ComfyUI/custom_nodes/comfyui-easy-media/utils/prompt_builder.py` (`MINIMAX_REF_PROMPT`) and `skills/minimax-h3-prompt-agentskill/references/ref2va-format.md`
- Easy-Media `nodes/minimax.py` (`REF_IMAGE_SHORT_EDGE = 2048`, `MAX_REF_IMAGES = 9`, match/max scaling), `nodes/project.py`, `nodes/basic.py`
- [ComfyUI-MiniMaxH3-Director (GitHub)](https://github.com/seesee75-commits/ComfyUI-MiniMaxH3-Director) and its installed README
- [MiniMax H3 Prompt Guide: Reference Images, Voice Referencing, and Storyboards — RunDiffusion](https://www.rundiffusion.com/minimax-h3-prompt-guide)
- [MiniMax H3 References to Video template — ai-flow.net](https://ai-flow.net/templates/minimax-h3-reference-to-video/)
- [MiniMax H3 Storyboard-to-Video: Multi-Shot Consistency Without OOM — Virse.ai](https://www.virse.ai/blog/minimax-h3-storyboard-to-video)
- [Kōda on X: MiniMax H3 with GPT Image 2 storyboards](https://x.com/aimikoda/status/2090556776156742071)
- [minimax_h3_r2v_story_board workflow — RunningHub](https://www.runninghub.ai/post/2091795373308719105/)
- [MiniMax H3 Guide — minimaxh3.studio](https://minimaxh3.studio/guide/minimax-h3)
