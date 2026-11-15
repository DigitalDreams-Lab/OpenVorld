# openVorld

Run a project, a company or any ongoing activity as a small pixel-art game. Your AI crew lives in the world, and they work through **quests**: workflows you design once and run again. You stay the founder, and you give the approvals.

- **Quests, not endless chat.** A quest is a goal and a list of steps. Each step goes to one crew member, and each step's result is handed to the next. Mark a step with the **Seal** and the quest waits there until you approve the result or send it back with a note.
- **Agents that feel like people.** Each member has a name, a job and a face. They walk to the Quest Board when a step starts, go home when it's done, and show a "!" when they're waiting for you.
- **Nothing is allowed until you say so.** Every member starts with only their own folder. If they need more, they ask for a **writ** (read a folder, run one command, visit one site), and you answer once, for this session or always.
- **Bring your own brain.** Claude Code or Codex if they're on your computer, or any OpenAI-compatible API (OpenRouter, OpenAI, Ollama, LM Studio). You can pick a different brain for each member.
- **Local and plain files.** Everything lives in `~/.openvorld`. Worlds, chats and quests are YAML, JSON and JSONL that you can read. There's no account and no cloud.

## Start

Requires Node 20+.

```bash
npm install
```

```bash
npm run dev
```

Open the address it prints. Found a world from a template (Software, Content, Business or Blank), then give each member a brain in their settings (⚙). A member without a brain answers with a short scripted line, so you can explore first.

To use another data folder:

```bash
OPENVORLD_HOME=~/my-worlds npm run dev
```

## How it plays

1. **The crew.** There's one companion (Buzz the bee by default), who is your guide and can draft quests for you, plus as many agents as you like. Each agent is just a name, a job title and a description of their job.
2. **The Quest Board.** Write a quest there, or ask the companion ("make me a weekly newsletter workflow") and edit the draft it pins to the board. Press **Start**.
3. **The run.** Steps run in order. Each step is a normal conversation you can open: you see its text, tool calls and file changes. A step that needs access stops at a writ card. A step marked with the Seal stops until you approve it.
4. **Progress.** Finished work earns XP and levels. Chat earns a little XP, capped per day, so the game rewards finished quests rather than talk. There are 15 deeds to unlock.

## Make it yours

Everything the game shows is a **pack**: YAML files that tell the engine what to show. Put your own packs in `~/.openvorld/packs` (or `<world>/packs` for a single world) to add templates, roles, deeds, themes or brains without touching the code. See [docs/PACKS.md](docs/PACKS.md).

```bash
npm run validate          # check every pack
```

```bash
npm run ov -- providers   # agent CLIs found on this computer
```

## Develop

```bash
npm test                  # engine and client tests, no network
```

```bash
npm run typecheck
```

How the pieces fit together is in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), and how to contribute is in [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT
