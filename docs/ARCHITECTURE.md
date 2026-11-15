# Architecture

openVorld has three parts: a small Node server, a React + Phaser client, and YAML packs. They talk over a local HTTP API and one WebSocket. Nothing leaves your computer except the calls a member's brain makes.

```
packs/ (YAML)  ─┐
~/.openvorld/  ─┼─►  engine/server  ◄──HTTP + WS──►  engine/client (React UI + Phaser world)
  worlds/<id>/ ─┘        │
                         └─► brains: claude / codex CLI, or an OpenAI-compatible API
```

## Data on disk

All of it sits under `OPENVORLD_HOME`, which defaults to `~/.openvorld`.

```
packs/                      your own packs (optional)
worlds/<id>/
  world.yaml                name, about, theme, crew, brains, work folder
  quests/<qid>.json         a quest: steps, status and its current run
  threads/index.json        every conversation, chat or quest step
  threads/<tid>.jsonl       a thread's events, append-only
  threads/<tid>.files/      files attached to that thread
  workspaces/<member>/      each member's own folder (the default)
  grants.yaml               the writs you have granted
  audit.log                 every tool call the engine ran, allowed or not
  saves/game.json           XP, level, deeds and event counts
  packs/                    packs for this world only (optional)
```

## Server (`engine/server`)

| File | What it does |
| --- | --- |
| `index.mjs` | HTTP routes and the WebSocket. Binds to 127.0.0.1, requires the per-launch token on every call, and checks Host. |
| `world.mjs` | Loads packs, lists and creates worlds, and builds the world context (`ctx`) every other module receives. |
| `quests.mjs` | The quest engine: save, start, advance step by step, the Seal, retry and stop. It also resumes quests after a restart. |
| `threads.mjs` | Conversations as JSONL event logs. |
| `agents/runner.mjs` | One turn for one member: builds the system prompt, picks the driver and stores the reply as ordered steps. |
| `agents/drivers/` | `claude.mjs`, `codex.mjs` (headless CLIs), `openai.mjs` (HTTP plus an engine-run tool loop) and `scripted.mjs` (no brain yet). |
| `agents/tools.mjs` | The tools the engine runs for API brains, always limited to the member's writs. |
| `agents/envelope.mjs` | Reads the fenced `ov` JSON block at the end of a reply: options, mood, balloon, access requests and a quest draft. |
| `agents/commands.mjs` | Game commands a member can send (walk somewhere, say something, emote). |
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

While a quest runs, the server sends `quest` events, and steps also send game commands so the member walks to the Quest Board and back. That's how the work shows up in the world.

## Client (`engine/client/src`)

- `screens/`: Title (choose a world), Onboarding (found one) and Game.
- `game/WorldScene.ts`: the Phaser map, with houses, the plaza with the Quest Board, members walking, speech balloons and the "!" markers.
- `ui/`: React panels. `QuestBoard.tsx`, `MemberPanel.tsx` + `Thread.tsx` (one conversation), `WritCard.tsx`, `Settings.tsx`, `MemberSettings.tsx`, `CrewBar.tsx`, `Hud.tsx`, `Deeds.tsx`.
- `store.ts`: one small store. Server events arrive over the WebSocket, and `Game.tsx` sends them on to the store and the scene.

## Safety model

- Each member gets their own work folder and nothing else.
- Every other kind of access is a writ, scoped to one path, one command pattern or one domain. The engine enforces writs on every tool call, and CLI brains also get their sandbox flags from them.
- Never-lists such as `~/.ssh` and `.env*` can't be granted at all.
- The server only listens on 127.0.0.1, with a random token for each launch.
