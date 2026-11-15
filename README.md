# OpenVorld

**Every project is a vorld.** A vorld is a project plus everyone working on it: the shared project folder, a crew of AI agents (each with a house, a vault and workbenches), the parties they form and work in together, and everything they've done so far. A project is just files; a vorld is the files plus the people and the work in progress.

OpenVorld is the open-source home for vorlds. You see each vorld as a small pixel-art world where the crew lives, and you run it as the founder: you form the parties, and you give the approvals.

```
vorld "Lantern Tea"
├── project folder     shared: every member reads it, changes need your writ
├── crew               a companion + agents; each has a house, a vault and workbenches
├── parties            named groups with a goal, chatting in one shared room
└── history            every chat, writ and deed, in plain files
```

- **Parties, like a group chat with bots.** A party is a name, a goal and one or more members. Open its chat at the **Party Hall** (the pillar in the plaza): the leader answers, hands work to a teammate by writing `@Name`, and the party keeps talking until the job is done. Every message shows who said it, and writ cards appear right in the room.
- **Agents that feel like people.** Each member has a name, a job and a face. A party walks to the Party Hall when its chat starts, speech balloons pop up as they talk, and they go home when the job is done.
- **One shared project, private workbenches.** The whole crew reads the vorld's project folder, and each member works on their own **workbenches** (folders you choose; several per member, and each chat starts on one). Anything more needs a **writ** (change the project, run one command, visit one site), and you answer once, for this session or always.
- **A house and a vault for every member.** Each member has a private house that never moves and that no folder writ can reach. Its **vault** holds their API keys, OAuth tokens and the sign-ins you made for them. They see only the names, ask for a key right in the chat (a private paste box on the card, never a normal message), use it only with a writ, and values are hidden in chats.
- **A browser for the crew.** Members that need the web browse in their own private Chrome, and you watch a live window in the game. Every site needs a writ, they never sign in or type passwords, and nothing on your computer or network can be reached. If a task needs a site you're logged in to, the chat shows a card where you sign in for that member yourself in a real window and approve a per-site writ, and anything that posts, sends, buys or deletes asks for your approval first. (Needs Google Chrome or Edge installed.)
- **Bring your own brain.** Claude Code or Codex if they're on your computer, or any OpenAI-compatible API (OpenRouter, OpenAI, Ollama, LM Studio). You can pick a different brain for each member.
- **Local and plain files.** Everything lives in `~/.openvorld`. Vorlds, parties and chats are YAML, JSON and JSONL that you can read. There's no account and no cloud.

## Start

For a desktop window with an automatically managed local engine, run `npm run desktop` after installing dependencies. On macOS, `npm run desktop:install` builds and installs OpenVorld into your Applications folder. See [desktop setup and installers](docs/DESKTOP.md).

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

1. **The crew.** There's one companion (Buzz the bee by default), who is your guide and helps you form parties, plus as many agents as you like. Each agent is just a name, a job title and a description of their job.
2. **The Party Hall.** Form a party: give it a name, a goal and its members (the first one leads). Templates start you with one.
3. **The room.** Write in the party's chat. The leader (or whoever you `@mention`) answers; a member who needs a teammate writes `@Name` and that teammate speaks next; a reply that mentions nobody ends the job. You see every member's text, tool calls and file changes. A member who needs access stops the room at a writ card, and it goes on when you answer.
4. **Progress.** Finished work earns XP and levels. Chat earns a little XP, capped per day, so the game rewards finished jobs rather than talk. There are 15 deeds to unlock.

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
