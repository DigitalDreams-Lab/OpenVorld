# Architecture

A **vorld** is the unit everything belongs to: one project folder, one crew, their parties and their history. OpenVorld has three parts: a small Node server, a React + Phaser client, and YAML packs. They talk over a local HTTP API and one WebSocket. Nothing leaves your computer except the calls a member's brain makes.

```
packs/ (YAML)  ─┐
~/.openvorld/  ─┼─►  engine/server  ◄──HTTP + WS──►  engine/client (React UI + Phaser map)
  vorlds/<id>/ ─┘        │
                         └─► brains: claude / codex CLI, or an OpenAI-compatible API
```

## Data on disk

All of it sits under `OPENVORLD_HOME`, which defaults to `~/.openvorld`.

```
packs/                      your own packs (optional)
vorlds/<id>/
  vorld.yaml                name, about, project folder, theme, crew, brains
  project/                  the shared project folder, unless vorld.yaml points at your own
  parties/<id>.json         a party: name, goal and members (the first leads)
  threads/index.json        every conversation: a chat with one member, or a party's shared room
  threads/<tid>.jsonl       a thread's events, append-only
  threads/<tid>.files/      files attached to that thread
  workbenches/<member>/     each member's Main bench (the default; more benches live wherever you pick)
  houses/<member>/vault/    each member's private house: secrets.env (named secrets) and session.json (sign-ins). Never shared
  grants.yaml               the writs you have granted
  audit.log                 every tool call the engine ran, allowed or not
  saves/game.json           XP, level, deeds and event counts
  packs/                    packs for this vorld only (optional)
```

## Server (`engine/server`)

| File | What it does |
| --- | --- |
| `index.mjs` | HTTP routes and the WebSocket. Binds to 127.0.0.1, requires the per-launch token on every call, and checks Host. |
| `vorld.mjs` | Loads packs, lists and creates vorlds, and builds the vorld context (`ctx`) every other module receives. |
| `parties.mjs` | Parties and their shared room: save a party, run a room (the leader answers, `@Name` hands over, no mention ends the job), pause on a writ, gather at the Party Hall and go home. |
| `threads.mjs` | Conversations as JSONL event logs. |
| `agents/runner.mjs` | One turn for one member: builds the system prompt, picks the driver and stores the reply as ordered steps. |
| `agents/drivers/` | `claude.mjs`, `codex.mjs` (headless CLIs), `openai.mjs` (HTTP plus an engine-run tool loop) and `scripted.mjs` (no brain yet). |
| `agents/tools.mjs` | The tools the engine runs for API brains, always limited to the member's writs. |
| `agents/envelope.mjs` | Reads the fenced `ov` JSON block at the end of a reply: options, mood, balloon, commands and access requests. |
| `agents/commands.mjs` | Game commands a member can send (walk somewhere, say something, emote). |
| `browser.mjs` | The crew browser: one private Chrome profile per member (plain, or signed in with the founder's saved sign-ins), driven through `playwright-core` and the Chrome or Edge on this computer. Enforces writs on every page, follows redirects itself, runs the sign-in window, and streams small JPEG frames to the game. |
| `agents/browse.mjs`, `agents/browser-mcp.mjs` | How brains reach the browser: API brains call it in-process; Claude Code and Codex start `browser-mcp.mjs`, a tiny MCP bridge that calls back into the engine's API with the launch token. |
| `gate.mjs` | Writs: check, grant and revoke, plus each capability's never-list. |
| `game.mjs` | XP, levels and deeds. |
| `art.mjs` | Works out which sprite frames belong to which member. |
| `attachments.mjs`, `benches.mjs`, `house.mjs`, `browse.mjs`, `models.mjs` | File uploads and references, workbenches and the project folder, the house and its vault (named secrets, `%NAME%` substitution, redaction), the folder picker and model lists. |

### A party room

1. The founder writes in a party chat (a thread of kind `party`, one shared transcript with every message tagged by speaker). `runParty` stores the message and picks the first speaker: the member the founder `@mentions`, else the leader (the first member).
2. Each speaker gets one turn through `runTurn` with `role` set to them and a prompt made of the party's goal, its members and the latest room messages. Room turns keep no CLI session of their own; the transcript is the memory.
3. When the reply arrives, the next speaker is the first teammate `@mentioned` in it (never yourself, never inside code). No mention ends the job. `party.max_turns` (default 12) stops a ping-pong; the room says it paused and a "continue" resumes it.
4. A member who asks for access pauses the room at a writ card. Answering it calls `resumeParty` for that member.
5. While the room runs, every member gets a `walk_to` plaza command (the Party Hall) and, when it ends, `go_home`. A finished job earns `party.job_done` and XP.

## Client (`engine/client/src`)

The founder's optional name and about-me description live in `<home>/profile.json`, shared across vorlds without a data migration. Settings edits the profile through authenticated `/api/profile` routes, the HUD displays the name alongside the unchanged level/title, and the current profile is supplied as background to agents on each turn (also refreshed in resumed CLI sessions). The avatar in the HUD opens profile settings.

Messages support isolated HTML/SVG previews (from fenced blocks, complete markup, and linked files), images, browser-native PDF/audio/video, Markdown, formatted JSON, CSV/TSV tables, and plain source/text files. `previews.ts` classifies formats and prepares static HTML; `ui/MessagePreview.tsx` owns preview dialogs and rendering. Local HTML assets are fetched through the existing conversation-scoped file route and embedded as data URLs. HTML runs in a scriptless opaque-origin sandbox with network, nested frames, forms, and parent access blocked. Preview reads are bounded; downloads retain their existing behavior.

`ui/AgentBalloons.tsx` shows each member's current action or latest response line above their map avatar, including a compact live preview while browsing. The scene reports camera-projected anchors after rendering, so balloons follow movement and zoom without updating the React store on every frame. Final lines persist briefly per member across party handoffs; restored idle browser frames do not reopen a window.

- `screens/`: Title (choose a vorld), Onboarding (found one) and Game.
- `game/VorldScene.ts`: the Phaser map, with houses, the plaza with the Party Hall, members walking, speech balloons and the "!" markers.
- `ui/`: React panels. `PartyHall.tsx` + `PartyPanel.tsx`, `MemberPanel.tsx` + `Thread.tsx` (one conversation), `WritCard.tsx`, `Settings.tsx`, `MemberSettings.tsx`, `CrewBar.tsx`, `Hud.tsx`, `Deeds.tsx`.
- `store.ts`: one small store. Server events arrive over the WebSocket, and `Game.tsx` sends them on to the store and the scene.

## Safety model

- Every member can read the vorld's project folder and can read and write their own workbenches (several, one default; each chat is fixed to one). Nothing else is open to them.
- Every member has a house (`<vorld>/houses/<member>/`) that never moves. No folder writ or workbench can hold it or contain it. Its vault keeps named secrets (`secrets.env`, owner-only) and that member's browser sign-ins. The model sees only secret names. A secret is used only with a `secret.use` writ for that name: API brains write `%NAME%` in a command and the engine swaps the value in; Claude Code and Codex get the secrets they hold a writ for as environment variables (their shell can print them, so the founder grants these one by one). A member asks for a secret with the `secret_ask` tool (also over the MCP bridge): it becomes a `secret.use` writ card with a private paste box, and the value goes to the vault through the writ answer, never into the thread. Every vault value is replaced by `$NAME` in tool output, chat, transcript and events.
- Changing the project folder needs an `fs.write` writ, the same as any other folder. Codex only receives `--add-dir` for folders it may write.
- Every other kind of access is a writ, scoped to one path, one command pattern or one domain. The engine enforces writs on every tool call, and CLI brains also get their sandbox flags from them.
- The crew browser opens only domains the member holds a `net.fetch` writ for (re-read on every call, redirects and link clicks included), never addresses on this computer or network, and never types into password or payment fields. A site without a writ becomes a writ card in the member's thread.
- Signed-in browsing is separate from plain browsing. The founder signs in to sites themselves in a real Chrome window (from a card in the chat: when a member opens a site with `signed_in` and has no saved sign-in there, the `net.session` writ card carries a sign-in button, and Allow stays disabled until the sign-in is saved); the cookies and local storage are saved per member to `<vorld>/houses/<member>/vault/session.json` (owner-only, never leaves the computer). A member gets them only through `browser_open{signed_in:true}`, only on sites where it holds a `net.session` writ, and in a context that can only navigate to those sites. Anything that acts as the founder (a submit-type click, a form POST, Enter in a comment box) needs a `net.act` writ, which can be given once or for the session, never "always". The act check is a guard rail based on form methods and button labels (`agent.browser.act_words`), not a guarantee for every site.
- Codex runs with `--ignore-user-config`, so plugins and MCP servers in your own Codex setup (computer-use, browser) can't drive your real apps around the writs.
- Never-lists such as `~/.ssh` and `.env*` can't be granted at all.
- The server only listens on 127.0.0.1, with a random token for each launch.
