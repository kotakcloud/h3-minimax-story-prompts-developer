# H3 Story Prompt Workshop

Local workshop for turning a story gist into MiniMax H3 T2VA prompts.

Stories are saved as JSON files under `data/stories/` on this machine. Each story has its own URL with an id and step:

```text
/stories/<id>/gist
/stories/<id>/cast
/stories/<id>/image
/stories/<id>/frames
/stories/<id>/prompts
```

Open one story, or open several in new tabs. The home page lists all of them.

1. Create a story and paste a gist.
2. **Progress: cast & location** extracts the characters and the main location (invented if the gist has none). Both are editable.
3. **Progress: reference image prompt** writes a Z-Image Turbo prompt for one still that shows every character in the location.
4. **Generate image** runs `comfy/z-image-turbo-t2i.json` in ComfyUI. Keep generating with new seeds and select the best one; it becomes the H3 reference image (`ComfyUI/output/h3-story/<id>/`).
5. **Progress: frames** breaks the story into editable clips (4–15s each), keeping the cast and location locked.
6. **Progress: H3 prompts** writes one paste-ready prompt per frame.
7. **Export** downloads `{ duration, prompt }` JSON for the other device.
8. **Video** renders the prompt set with the selected reference image in ComfyUI. Pick a workflow:
   - **Veda Turbo** (default for new stories, `comfy/h3-story-veda-turbo.json`) and **Sage SLA** (`comfy/h3-story-sage-sla.json`): the fast "Story Speed Tests" workflows from ComfyUI (`user/default/workflows/MiniMax H3/Story Speed Tests`), converted to API format with ComfyUI's own frontend. Both use the ref2va w4a8 mixed model in a single pass, every segment a `ref` task (`ref_image_size: max`). Veda Turbo: Taomate 3-step LoRA, Veda sparse attention, 4 steps. **Singularity Veda** (`comfy/h3-story-singularity-veda.json`, same layout): the Singularity v2 ref2va w4a8 fine-tune with the Taomate 3-step LoRA and Veda sparse attention, 3 steps; project folders `h3s_<id>_sveda[_dev]`. Sage SLA: ref2v turbo 8-step LoRA, Sage + H3 SLA 0.85, 10 steps. DEV renders 544×960 (FULL 768×1344) for 9:16, 960×544 (1344×768) for 16:9, and a custom size with the same pixel count for other ratios. Project folders `h3s_<id>_veda[_dev]` / `h3s_<id>_sage[_dev]`. The time estimate comes from earlier finished runs of the same workflow in the story. If you change the ComfyUI files, re-export them to `comfy/` (same node ids).
   - **Long take** (`comfy/h3-long-take-ref.json`): fl2va model, single pass, RTX VSR. DEV = draft, off = final.
   - **Story V2** (`comfy/h3-story-v2-ref2va.json`, from the Themed Transformation Pipeline): ref2va model, every segment a `ref` task on the same image, dual pass with a x1.25 latent-upscale refine. DEV and FULL each have their own megapixels / steps (default 0.3 MP / 10 steps) and project folder (`h3s_<id>_v2_dev` / `h3s_<id>_v2`). Proven with segments of 8 s or less; the Workshop's timestamped prompts are not yet tested with it. Details: `docs/HANDOFF_h3_story_v2_for_workshop_app.md`.

Image generation needs ComfyUI running with the Z-Image Turbo models from the template. Set `COMFYUI_URL` in `.env.local` if ComfyUI is not at `http://127.0.0.1:8188`.

On the Image tab you can also **upload your own picture** (Upload image, or drop a file on the image area). The browser converts it to PNG (scaled down to at most 4 MP) and the app stores it in ComfyUI's output folder next to the generated ones (`h3-story/<story id>/upload_<time>.png`), so both video workflows use it the same way. Its aspect ratio is matched to the nearest supported one. The **Layout** box under the prompt (who stands where) feeds the H3 prompts: edit it to match an uploaded picture.

### Testing, LoRAs and rating (Video tab)

- **Queue several videos**: *Generate video* stays available while others render (*Queue another video*); ComfyUI
  runs them one after another and each card shows its own place in the queue and progress.
- **Skip segments after N**: tick it and set N to render only the first N segments of the prompt set, to try a look
  before rendering a long story. The run's details say "test: first N of M".
- **LoRAs · edit** opens the enhancement-LoRA popup. It lists what ComfyUI has in `models/loras/minimax-h3`, scanned
  fresh every time it opens (new files show up without a restart). Tick a LoRA and set its strength (-2..2); speed
  LoRAs are marked and hidden by default (*Hide speed LoRAs*; an enabled one stays visible), since the fast
  workflows already carry their own. Enabled LoRAs are chained right after the
  workflow's model loader (`LoraLoaderModelOnly`), in list order, for every workflow; the server rejects names ComfyUI
  does not know. Each run's details list the LoRAs and strengths it used.
- **Rating**: give each finished video 1-5 stars (click the same star again to clear) and a short note; **Best rated**
  sorts the list by stars. Rated videos collapse to a one-line summary (stars and note stay visible); the ▸ / ▾
  title button expands or collapses any card, and that choice is kept.
- **Compare**: press *Compare*, tick 2-4 finished videos (they become A, B, C, D in pick order), choose whose audio to
  keep and press *Create comparison*. ffmpeg stitches them side by side (2x2 for four), each under a header with its
  workflow, quality, prompt set, length, seed and LoRAs; shorter clips hold their last frame. Comparisons get their own
  section with the video, the full info of each side (with its stars and note), a note box and a delete button that
  also removes the file. Files: `data/comparisons/<story id>/<id>.mp4`. With `COMFYUI_OUTPUT_DIR` in `.env.local` the
  videos are read straight from ComfyUI's output folder (seconds instead of a minute through ComfyUI's /view).
- **Full-screen view**: click a generation's reference thumbnail (or the big image on the Image tab) to open it full
  screen; ← / → step through the story's images and a storyboard grid's panels, Esc or a click outside closes.
- **Delete** (bin icon on a finished, failed or cancelled video) removes it from the story after a confirmation; the
  video file stays in ComfyUI's output folder (ComfyUI has no delete call).

### Dialogue in another language

On the Prompts tab, type a language (Gujarati, Hindi, ...) and press **Language version**: the app copies the current
prompt set and translates only the spoken lines (`<d>[Language] ...</d>`), in the language's own script, keeping their
length and emotion. Everything else (shots, camera, panels, looks) stays identical, so rendering it with the same seed
gives the same film in the other language. The new set is marked with its language on its set button.

### Storyboard grids

A reference picture can be a **storyboard grid** of scenes. Tick *Storyboard grid of scenes* and set rows x columns before
uploading: the browser also cuts the panels out (trimming white gutters) and the panel aspect ratio becomes the video's.
Use clean panels without captions or numbers, the same characters in every panel. Then:

- **Frames > Frames from grid** sends the picture to the story's AI model (needs one that can see images, e.g.
  `google/gemini-3.7-flash`) and writes one frame per panel (reading order), each with its panel and a *Cut* join, and
  updates the character looks to what the panels show. Panel and join can be changed per frame.
- **Image tab**: choose what H3 gets on each segment: the **whole grid**, naming the segment's panel (default), or **only
  the segment's own panel** (faster). Both were tested on Veda Turbo: H3 opens each segment on the right panel with no grid
  borders in the video (`docs/RESEARCH_grid_reference_image.md`, section 6).
- **Prompts** name `<Picture 1>` as the storyboard reference for the segment's panel; cut segments start fresh (no
  continuation opener or +0.92 s timing).
- **Video**: every cut is a fresh shot (`continuity_mode: shot`), the reference keeps its detail (`ref_image_size: max`),
  and grids need a ref2va workflow (Veda Turbo, Sage SLA, Story V2), not the long take.

### Spend badge

The top bar shows `Spent: $X.XX` (plus ` / $LIMIT` when the key has a limit): the total spend of the OpenRouter key, read from OpenRouter's `GET /api/v1/auth/key` by the server route `/api/openrouter-usage`. Only `usage` and `limit` reach the browser, never the key. The server caches a good answer for 60 s; the badge refreshes every minute while the tab is visible and stays hidden on any failure. It counts every project that uses the same key.

### Fixed header

The top bar (`components/top-bar.tsx`) stays fixed while scrolling; its height is `--nav-h` in `app/globals.css`, used for the content's top padding and for the story page's pinned block (title row + step tabs) right under it. Keep their ancestors free of `overflow: hidden/auto`, or sticky stops working.

## Setup

Install Node.js and npm, then from PowerShell run:

```powershell
Copy-Item .env.example .env.local
```

Add your OpenRouter key to `.env.local` to enable story breakdown and prompt generation. Then start the app:

```powershell
.\start.ps1
```

The launcher installs dependencies when needed and frees port `38217` if it is already in use. Open the local app at:

```text
http://localhost:38217
```

The app binds to `0.0.0.0:38217`, so another machine on the same Wi-Fi can open:

```text
http://<this-computer-lan-ip>:38217
```

On Windows, find the PC's LAN address with `ipconfig`. Open that URL on the other machine. Do not start a second copy of the app there, or you will see an empty story list. If the other machine cannot connect, allow Node.js through Windows Defender Firewall on private networks.

Default model: `deepseek/deepseek-v4-flash-0731` (`OPENROUTER_MODEL` in `.env.local`, may be a comma-separated fallback chain).

### Choosing the AI model

Each story has an **AI model (OpenRouter)** field at the top of the left sidebar, used by every AI step of that story (analysis, cast, image prompt, frames, H3 prompts and updates). It is free text with a suggestion list (`lib/models.ts`): pick one, type any OpenRouter id, or comma-separate up to three ids as a fallback chain (more are cut to three). New stories start with `google/gemini-3.7-flash`, the recommended choice (fast, about a cent per call; the Use recommended link fills it back in). Blank means the `.env` default (older stories without the field also use it). The note under the field shows the model that will be used and turns amber for free/basic models. The server validates the ids (`provider/model`) and answers 400 for anything else; the dev-server log shows which model actually answered when it was a fallback. Prices in the list are approximate.

## Skills in this repo

- `skills/minimax-h3-prompt-agentskill/` — copy of [benjiyaya/Minimax-H3-Prompt-AgentSkill](https://github.com/benjiyaya/Minimax-H3-Prompt-AgentSkill)
- `skills/h3-prompt-writing/` — official MiniMax H3 prompt-writing skill
- `prompts/` — compiled system prompts used by the app
