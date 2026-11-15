# Contributing

Thanks for helping. openVorld aims to stay small, so a change is most welcome when it makes running work as a game simpler or clearer.

## Setup

```bash
npm install
npm run dev
```

Your dev vorlds go in `~/.openvorld` unless you set `OPENVORLD_HOME`, or pin a folder in a git-ignored `.openvorld-dev.json`:

```json
{ "home": "../openvorld-data", "port": 4329, "client_port": 5185 }
```

## Before you open a pull request

```bash
npm test && npm run typecheck && npm run validate
```

Tests use `node --test`, and nothing in them touches the network: model APIs are mocked with `fetch` stubs (see `tests/quests.test.mjs`).

## Guidelines

- **Packs before code.** If something can be a YAML setting (a word, a template, a deed, a brain preset), put it in a pack. See [docs/PACKS.md](docs/PACKS.md).
- **No new access paths.** Anything a member does outside their own folder goes through a writ (`engine/server/gate.mjs`).
- **Local first.** No accounts, no telemetry, no hosted services.
- **Plain files.** Vorld data stays readable: YAML, JSON and JSONL.
- **Keep it small.** Open an issue before adding a big feature, so we can agree it belongs in the core rather than in a pack.
