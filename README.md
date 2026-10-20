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
   - **Long take** (`comfy/h3-long-take-ref.json`): fl2va model, single pass, RTX VSR. DEV = draft, off = final.
   - **Story V2** (`comfy/h3-story-v2-ref2va.json`, from the Themed Transformation Pipeline): ref2va model, every segment a `ref` task on the same image, dual pass with a x1.25 latent-upscale refine. DEV and FULL each have their own megapixels / steps (default 0.3 MP / 10 steps) and project folder (`h3s_<id>_v2_dev` / `h3s_<id>_v2`). Proven with segments of 8 s or less; the Workshop's timestamped prompts are not yet tested with it. Details: `docs/HANDOFF_h3_story_v2_for_workshop_app.md`.

Image generation needs ComfyUI running with the Z-Image Turbo models from the template. Set `COMFYUI_URL` in `.env.local` if ComfyUI is not at `http://127.0.0.1:8188`.

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

Default model: `deepseek/deepseek-v4-flash-0731`.

## Skills in this repo

- `skills/minimax-h3-prompt-agentskill/` — copy of [benjiyaya/Minimax-H3-Prompt-AgentSkill](https://github.com/benjiyaya/Minimax-H3-Prompt-AgentSkill)
- `skills/h3-prompt-writing/` — official MiniMax H3 prompt-writing skill
- `prompts/` — compiled system prompts used by the app
