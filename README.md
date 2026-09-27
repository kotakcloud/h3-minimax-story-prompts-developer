# H3 Story Prompt Workshop

Local workshop for turning a story gist into MiniMax H3 T2VA prompts.

Stories are saved as JSON files under `data/stories/` on this machine. Each story has its own URL with an id and step:

```text
/stories/<id>/gist
/stories/<id>/frames
/stories/<id>/prompts
```

Open one story, or open several in new tabs. The home page lists all of them.

1. Create a story and paste a gist.
2. **Progress: frames** breaks it into editable clips (4–15s each).
3. **Progress: H3 prompts** writes one paste-ready prompt per frame.
4. **Export** downloads `{ duration, prompt }` JSON for the other device.

## Setup

Install Node.js and npm, then from PowerShell run:

```powershell
Copy-Item .env.example .env.local
```

Add your OpenRouter key to `.env.local` to enable story breakdown and prompt generation. Then start the app:

```powershell
.\start.ps1
```

The launcher installs dependencies when needed and frees port `48217` if it is already in use. Open the local app at:

```text
http://localhost:48217
```

The app binds to `0.0.0.0:48217`, so another machine on the same Wi-Fi can open:

```text
http://<this-computer-lan-ip>:48217
```

On Windows, find the PC's LAN address with `ipconfig`. Open that URL on the other machine. Do not start a second copy of the app there, or you will see an empty story list. If the other machine cannot connect, allow Node.js through Windows Defender Firewall on private networks.

Default model: `deepseek/deepseek-v4-flash-0731`.

## Skills in this repo

- `skills/minimax-h3-prompt-agentskill/` — copy of [benjiyaya/Minimax-H3-Prompt-AgentSkill](https://github.com/benjiyaya/Minimax-H3-Prompt-AgentSkill)
- `skills/h3-prompt-writing/` — official MiniMax H3 prompt-writing skill
- `prompts/` — compiled system prompts used by the app
