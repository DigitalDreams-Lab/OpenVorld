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
  houses/<member>/memory/   the member's memory: notes.json (their notebook) and chats.json (a summary of each chat they took part in)
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
| `parties.mjs` | Parties and their shared room: save a party, run a room (the leader answers, `@Name` hands over, `@all` from the founder asks everyone, no mention ends the job), pause on a writ, join the founder and stay nearby between messages. |
| `threads.mjs` | Conversations as JSONL event logs. |
| `agents/runner.mjs` | One turn for one member: builds the system prompt, picks the driver and stores the reply as ordered steps. |
| `agents/drivers/` | `claude.mjs`, `codex.mjs`, `antigravity.mjs`, `opencode.mjs` (headless CLIs), `command.mjs` (any other harness a pack describes: prompt in, reply out), `openai.mjs` (HTTP plus an engine-run tool loop) and `scripted.mjs` (no brain yet). CLIs start through `cross-spawn`, so Windows `.cmd` shims work too, which is also why no argument may hold a newline (`cmd.exe` cuts the command line there): Claude Code reads its system prompt from a temporary file, and Codex and OpenCode get their prompts on stdin. |
| `agents/tools.mjs` | The tools the engine runs for API brains, always limited to the member's writs. |
| `agents/envelope.mjs` | Reads the fenced `ov` JSON block at the end of a reply: options, mood, balloon, commands, access requests and memory (`remember`, `forget`, `summary`). |
| `memory.mjs` | Crew memory, kept in each member's house: the notebook (shown in every turn), one summary per chat (the latest few start a new chat), and the `recall` tool that searches older chats. |
| `party-files.mjs` | A party's shared folder, `<vorld>/parties/<id>/shared/`: the engine copies into it what is shared in a room (the founder's attachments, pictures from tools, files a member lists in `share`), and every member reads it with its own file tools. It is made with the party and kept when the party is deleted. |
| `agents/commands.mjs` | Game commands a member can send (walk somewhere, say something, emote). |
| `browser.mjs` | The crew browser: one private Chrome profile per member (plain, or signed in with the founder's saved sign-ins), driven through `playwright-core` and the Chrome or Edge on this computer. Enforces writs on every page, checks every redirect inside Chrome (pages load natively, so Google and YouTube's very large headers work), runs the sign-in window, and streams small JPEG frames to the game. |
| `bridge-token.mjs` | The tool bridge's token: one per member per turn, valid only for that member's own bridge call (`POST .../browser/<member>/<tool>` in that thread) and revoked when the turn ends. The launch token (the whole API) never goes to a brain. |
| `agents/browse.mjs`, `agents/browser-mcp.mjs` | How brains reach the engine's own tools (the browser, `secret_ask` and `recall`): API brains call them in-process; Claude Code, Codex, Antigravity, OpenCode and any brain whose pack sets `mcp_args` reach them through `browser-mcp.mjs`, a tiny MCP bridge that calls back into the engine's API. Each CLI is handed the bridge its own way: a flag (Claude Code), `-c` settings (Codex), a temporary `.agents/mcp_config.json` plus a session-only allow rule (Antigravity), `OPENCODE_CONFIG_CONTENT` (OpenCode), or a temporary `mcpServers` file (`{mcp_config}` and `$OV_MCP_CONFIG`, for the command driver). |
| `gate.mjs` | Writs: check, grant and revoke, plus each capability's never-list. |
| `game.mjs` | XP, levels and deeds. |
| `art.mjs` | Works out which sprite frames belong to which member. |
| `attachments.mjs`, `benches.mjs`, `house.mjs`, `browse.mjs`, `models.mjs` | File uploads and references, workbenches and the project folder, the house and its vault (named secrets, `%NAME%` substitution, redaction), the folder picker and model lists. |

### Crew memory

A member remembers between chats through `memory.mjs`, the same way for every brain:

1. **Notebook.** A member adds short facts with `remember` in its `ov` block, and drops wrong or outdated ones with `forget` (by note id). The engine hides vault values, skips duplicates and stops at `agent.memory.notes_max`. The notebook is in every turn's prompt, and a resumed CLI session gets it again with each message. New notes show under the reply in the chat.
2. **Chat summaries.** Every reply carries a `summary` of where the whole chat stands. It replaces the previous one for that chat. A new chat starts with the latest few summaries (`agent.memory.recent_chats`). In a party room, each member who speaks keeps their own summary of it.
3. **Recall.** The `recall` tool searches the member's own chats and the party rooms they spoke in (summaries and messages, by keyword), or reads one chat back. API brains run it in-process; every other brain reaches it over the MCP bridge.

The founder reads, edits and removes all of it in the member's settings (Memory). `agent.memory.enabled: false` turns it off.

### A party room

1. The founder writes in a party chat (a thread of kind `party`, one shared transcript with every message tagged by speaker). `runParty` stores the message and picks the speakers: every member in party order when the founder writes `@all` (or `@everyone`, `@team`, `@crew`; a code block, an email or a member with that name does not count), else the member the founder `@mentions`, else the leader (the first member). Only the founder can ask everyone: an `@all` in a member's reply is not a mention. The members still waiting are kept on the thread (`queue`).
2. Each speaker gets one turn through `runTurn` with `role` set to them and a prompt made of the party's goal, its members and the latest room messages. Room turns keep no CLI session of their own; the transcript is the memory.
3. When the reply arrives, the next speaker is the first teammate `@mentioned` in it (never yourself, never inside code). No mention ends the job. `party.max_turns` (default 12) stops a ping-pong; the room says it paused and a "continue" resumes it.
4. A member who asks for access pauses the room at a writ card. Answering it calls `resumeParty` for that member, and the members still waiting from an `@all` take their turns after it.
5. When the room starts, a `party.gather` event brings its members to the founder. They stay nearby between replies until dismissed, rather than walking away to the hall or home. A finished job earns `party.job_done` and XP.

## Client (`engine/client/src`)

Pending approvals open a focused request dialog with the original thread ID, so requests from party rooms never divert into an agent's private chat. Member and party panels keep pending-request buttons above their conversations, including requests in older chats. Answers use the existing approval API and resume the originating party; closing the dialog leaves the request pending.

Large character sheets are served as lossless PNG pages of at most 2048 pixels per side, aligned to whole sprite cells. The source artwork and pack layout stay unchanged. The atlas names each page and gives coordinates within it; the authenticated art route generates and caches the pages. Portraits load independently of walking frames, and failed atlas downloads are reported instead of caching an incomplete atlas and showing invisible characters.

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
- The tool bridge never gets the launch token. A brain can often read what its bridge is given (a config file in a folder it may read, its command line, its environment), and the launch token opens the whole API, including answering writs. The bridge gets a random token for one member's one turn that opens only that member's own tools in that thread, and stops working when the turn ends. What a leaked bridge token can do is what the member can already do, with every writ still checked.
- A party's shared folder is read-only for its members (no writ, nothing becomes writable because of it). Members put files there only through the engine: it copies attachments and the files a member names in `share`, and only files that member can already read (its own folders and writs, never a never-listed path). OpenVorld hands the brain the folder's path and lets its own tools decide how to open each file; it does not pass images itself.
- A member's memory lives in its house, so no writ reaches it, and `recall` only opens chats that member took part in. Vault values are hidden before anything is saved there.
- A brain on the generic `command` driver is a harness the engine does not drive: it runs in the member's workbench with whatever its own settings allow, and writs reach it only as words in its prompt. A harness whose pack sets `mcp_args` also receives the bridge's tools (browser, `secret_ask`, `recall`) as a temporary `mcpServers` file, and its environment holds the bridge's address and token (`OV_URL`, `OV_TOKEN`, `OV_MCP_CONFIG`). Add only harnesses you trust, in their safest mode.
- Codex runs with `--ignore-user-config`, so plugins and MCP servers in your own Codex setup (computer-use, browser) can't drive your real apps around the writs.
- Codex runs its shell commands offline. A `net.cli` writ (scope `*`, never "always") opens the network for them: Codex's sandbox has one switch for every site, and only in a writable workbench, so a member without one is asked for it too. The engine asks for the writ when a command fails to resolve a host, and sets the switch on every turn, so a revoked writ takes a resumed session offline again. Claude Code commands are governed by `cmd.run` writs instead.
- Never-lists such as `~/.ssh` and `.env*` can't be granted at all.
- The server only listens on 127.0.0.1, with a random token for each launch.
