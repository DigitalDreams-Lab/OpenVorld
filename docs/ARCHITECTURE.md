# Architecture

A **vorld** is the unit everything belongs to: one project folder, one crew, their quests and their history. OpenVorld has three parts: a small Node server, a React + Phaser client, and YAML packs. They talk over a local HTTP API and one WebSocket. Nothing leaves your computer except the calls a member's brain makes.

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
  quests/<qid>.json         a quest: steps, status and its current run
  threads/index.json        every conversation, chat or quest step
  threads/<tid>.jsonl       a thread's events, append-only
  threads/<tid>.files/      files attached to that thread
  workspaces/<member>/      each member's private workspace (the default)
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
| `quests.mjs` | The quest engine: save, start, advance step by step, the Seal, retry and stop. It also resumes quests after a restart. |
| `threads.mjs` | Conversations as JSONL event logs. |
| `agents/runner.mjs` | One turn for one member: builds the system prompt, picks the driver and stores the reply as ordered steps. |
| `agents/drivers/` | `claude.mjs`, `codex.mjs` (headless CLIs), `openai.mjs` (HTTP plus an engine-run tool loop) and `scripted.mjs` (no brain yet). |
| `agents/tools.mjs` | The tools the engine runs for API brains, always limited to the member's writs. |
| `agents/envelope.mjs` | Reads the fenced `ov` JSON block at the end of a reply: options, mood, balloon, access requests and a quest draft. |
| `agents/commands.mjs` | Game commands a member can send (walk somewhere, say something, emote). |
| `browser.mjs` | The crew browser: one private Chrome profile per member (plain, or signed in with the founder's saved sign-ins), driven through `playwright-core` and the Chrome or Edge on this computer. Enforces writs on every page, follows redirects itself, runs the sign-in window, and streams small JPEG frames to the game. |
| `agents/browse.mjs`, `agents/browser-mcp.mjs` | How brains reach the browser: API brains call it in-process; Claude Code and Codex start `browser-mcp.mjs`, a tiny MCP bridge that calls back into the engine's API with the launch token. |
| `gate.mjs` | Writs: check, grant and revoke, plus each capability's never-list. |
| `game.mjs` | XP, levels and deeds. |
| `art.mjs` | Works out which sprite frames belong to which member. |
| `attachments.mjs`, `workspace.mjs`, `browse.mjs`, `models.mjs` | File uploads and references, work folders, the folder picker and model lists. |

### A quest run

1. `startQuest` sets `status: running` and calls `advance`.
2. `advance` takes the current step and opens a thread for it (kind `quest`). The thread gets a brief with the quest goal, the step's task and the results of earlier steps. Then `runTurn` runs that member's turn.
3. When the reply arrives, it is stored in `run.outputs[step]`.
   - If the member asked for access, the quest waits (`waiting: writ`). It goes on once you answer the writ.
   - If the step has `seal: true`, the quest waits (`waiting: seal`). Approve it and the quest moves to the next step. Send it back and your note goes to the same member in the same thread.
   - Otherwise it moves to the next step.
4. If the brain fails, the quest is marked `failed` with the reason. **Retry** runs the same step again.

While a quest runs, the server sends `quest` events, and steps also send game commands so the member walks to the Quest Board and back. That's how the work shows up in the vorld.

## Client (`engine/client/src`)

- `screens/`: Title (choose a vorld), Onboarding (found one) and Game.
- `game/VorldScene.ts`: the Phaser map, with houses, the plaza with the Quest Board, members walking, speech balloons and the "!" markers.
- `ui/`: React panels. `QuestBoard.tsx`, `MemberPanel.tsx` + `Thread.tsx` (one conversation), `WritCard.tsx`, `Settings.tsx`, `MemberSettings.tsx`, `CrewBar.tsx`, `Hud.tsx`, `Deeds.tsx`.
- `store.ts`: one small store. Server events arrive over the WebSocket, and `Game.tsx` sends them on to the store and the scene.

## Safety model

- Every member can read the vorld's project folder and can read and write their own private workspace. Nothing else is open to them.
- Changing the project folder needs an `fs.write` writ, the same as any other folder. Codex only receives `--add-dir` for folders it may write.
- Every other kind of access is a writ, scoped to one path, one command pattern or one domain. The engine enforces writs on every tool call, and CLI brains also get their sandbox flags from them.
- The crew browser opens only domains the member holds a `net.fetch` writ for (re-read on every call, redirects and link clicks included), never addresses on this computer or network, and never types into password or payment fields. A site without a writ becomes a writ card in the member's thread.
- Signed-in browsing is separate from plain browsing. The founder signs in to sites themselves in a real Chrome window (Settings > Signed-in browsing); the cookies and local storage are saved to `<vorld>/browser/session.json` (owner-only, never leaves the computer). A member gets them only through `browser_open{signed_in:true}`, only on sites where it holds a `net.session` writ, and in a context that can only navigate to those sites. Anything that acts as the founder (a submit-type click, a form POST, Enter in a comment box) needs a `net.act` writ, which can be given once or for the session, never "always". The act check is a guard rail based on form methods and button labels (`agent.browser.act_words`), not a guarantee for every site.
- Codex runs with `--ignore-user-config`, so plugins and MCP servers in your own Codex setup (computer-use, browser) can't drive your real apps around the writs.
- Never-lists such as `~/.ssh` and `.env*` can't be granted at all.
- The server only listens on 127.0.0.1, with a random token for each launch.
