# H3 Story Prompt Workshop

Local workshop for turning a story gist into MiniMax H3 T2VA prompts.

1. Paste a gist.
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

Default model: `deepseek/deepseek-v4-flash-0731`.

## Skills in this repo

- `skills/minimax-h3-prompt-agentskill/` — copy of [benjiyaya/Minimax-H3-Prompt-AgentSkill](https://github.com/benjiyaya/Minimax-H3-Prompt-AgentSkill)
- `skills/h3-prompt-writing/` — official MiniMax H3 prompt-writing skill
- `prompts/` — compiled system prompts used by the app
