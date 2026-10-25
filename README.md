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
   - **Veda Turbo** (default for new stories, `comfy/h3-story-veda-turbo.json`) and **Sage SLA** (`comfy/h3-story-sage-sla.json`): the fast "Story Speed Tests" workflows from ComfyUI (`user/default/workflows/MiniMax H3/Story Speed Tests`), converted to API format with ComfyUI's own frontend. Both use the ref2va w4a8 mixed model in a single pass, every segment a `ref` task (`ref_image_size: max`). Veda Turbo: Taomate 3-step LoRA, Veda sparse attention, 4 steps. Sage SLA: ref2v turbo 8-step LoRA, Sage + H3 SLA 0.85, 10 steps. DEV renders 544×960 (FULL 768×1344) for 9:16, 960×544 (1344×768) for 16:9, and a custom size with the same pixel count for other ratios. Project folders `h3s_<id>_veda[_dev]` / `h3s_<id>_sage[_dev]`. The time estimate comes from earlier finished runs of the same workflow in the story. If you change the ComfyUI files, re-export them to `comfy/` (same node ids).
   - **Long take** (`comfy/h3-long-take-ref.json`): fl2va model, single pass, RTX VSR. DEV = draft, off = final.
   - **Story V2** (`comfy/h3-story-v2-ref2va.json`, from the Themed Transformation Pipeline): ref2va model, every segment a `ref` task on the same image, dual pass with a x1.25 latent-upscale refine. DEV and FULL each have their own megapixels / steps (default 0.3 MP / 10 steps) and project folder (`h3s_<id>_v2_dev` / `h3s_<id>_v2`). Proven with segments of 8 s or less; the Workshop's timestamped prompts are not yet tested with it. Details: `docs/HANDOFF_h3_story_v2_for_workshop_app.md`.

Image generation needs ComfyUI running with the Z-Image Turbo models from the template. Set `COMFYUI_URL` in `.env.local` if ComfyUI is not at `http://127.0.0.1:8188`.

On the Image tab you can also **upload your own picture** (Upload image, or drop a file on the image area). The browser converts it to PNG (scaled down to at most 4 MP) and the app stores it in ComfyUI's output folder next to the generated ones (`h3-story/<story id>/upload_<time>.png`), so both video workflows use it the same way. Its aspect ratio is matched to the nearest supported one. The **Layout** box under the prompt (who stands where) feeds the H3 prompts: edit it to match an uploaded picture.

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
