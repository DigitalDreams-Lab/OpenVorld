# OpenVorld

**Every project is a vorld.** A vorld is a project plus everyone working on it: the shared project folder, a crew of AI agents (each with a private workspace), the quests they plan and run together, and everything they've done so far. A project is just files; a vorld is the files plus the people and the work in progress.

OpenVorld is the open-source home for vorlds. You see each vorld as a small pixel-art world where the crew lives, and you run it as the founder: you design the workflows, and you give the approvals.

```
vorld "Lantern Tea"
├── project folder     shared: every member reads it, changes need your writ
├── crew               a companion + agents, each with a private workspace
├── quests             workflows: step → step → your Seal → done
└── history            every chat, step, writ and deed, in plain files
```

- **Quests, not endless chat.** A quest is a goal and a list of steps. Each step goes to one crew member, and each step's result is handed to the next. Mark a step with the **Seal** and the quest waits there until you approve the result or send it back with a note.
- **Agents that feel like people.** Each member has a name, a job and a face. They walk to the Quest Board when a step starts, go home when it's done, and show a "!" when they're waiting for you.
- **One shared project, private workspaces.** The whole crew reads the vorld's project folder, and each member drafts in their own workspace. Anything more needs a **writ** (change the project, run one command, visit one site), and you answer once, for this session or always.
- **A browser for the crew.** Members that need the web browse in their own private Chrome, and you watch a live window in the game. Every site needs a writ, they never sign in or type passwords, and nothing on your computer or network can be reached. (Needs Google Chrome or Edge installed.)
- **Bring your own brain.** Claude Code or Codex if they're on your computer, or any OpenAI-compatible API (OpenRouter, OpenAI, Ollama, LM Studio). You can pick a different brain for each member.
- **Local and plain files.** Everything lives in `~/.openvorld`. Vorlds, chats and quests are YAML, JSON and JSONL that you can read. There's no account and no cloud.

## Start

Requires Node 20+.

```bash
npm install
```

```bash
npm run dev
```

Open the address it prints and create a vorld: give it a name, point it at a project folder (an existing repo or folder, or a new one), and start from a template (Software, Content, Business or Blank). Then give each member a brain in their settings (⚙). A member without a brain answers with a short scripted line, so you can explore first.

To use another data folder:

```bash
OPENVORLD_HOME=~/my-vorlds npm run dev
```

## How it plays

1. **The crew.** There's one companion (Buzz the bee by default), who is your guide and can draft quests for you, plus as many agents as you like. Each agent is just a name, a job title and a description of their job.
2. **The Quest Board.** Write a quest there, or ask the companion ("make me a weekly newsletter workflow") and edit the draft it pins to the board. Press **Start**.
3. **The run.** Steps run in order. Each step is a normal conversation you can open: you see its text, tool calls and file changes. A step that needs access stops at a writ card. A step marked with the Seal stops until you approve it.
4. **Progress.** Finished work earns XP and levels. Chat earns a little XP, capped per day, so the game rewards finished quests rather than talk. There are 15 deeds to unlock.

## Make it yours

Everything the game shows is a **pack**: YAML files that tell the engine what to show. Put your own packs in `~/.openvorld/packs` (or `<vorld>/packs` for a single vorld) to add templates, roles, deeds, themes or brains without touching the code. See [docs/PACKS.md](docs/PACKS.md).

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
