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

```bash
cp .env.example .env.local
# add your OpenRouter key
npm install
npm run dev
```

The app binds to `0.0.0.0:48217`, so another machine on the same Wi-Fi can open:

```text
http://<this-computer-lan-ip>:48217
```

On this Mac the LAN address is printed as **Network** when you start the server. If the other machine cannot connect, allow incoming connections for Node in macOS Firewall.

Default model: `deepseek/deepseek-v4-flash-0731`.

## Skills in this repo

- `skills/minimax-h3-prompt-agentskill/` — copy of [benjiyaya/Minimax-H3-Prompt-AgentSkill](https://github.com/benjiyaya/Minimax-H3-Prompt-AgentSkill)
- `skills/h3-prompt-writing/` — official MiniMax H3 prompt-writing skill
- `prompts/` — compiled system prompts used by the app
