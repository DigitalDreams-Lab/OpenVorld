# Contributing

Thanks for helping. OpenVorld aims to stay small, so a change is most welcome when it makes running work as a game simpler or clearer.

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

Tests use `node --test`, and nothing in them touches the network: model APIs are mocked with `fetch` stubs (see `tests/parties.test.mjs`).

## Versioning

**Every commit bumps the version** and says why in [CHANGELOG.md](CHANGELOG.md):

```bash
npm run bump -- patch "Fix the Brain list when the server restarts"
npm run bump -- minor "Eight-direction characters"
```

- **patch**: fixes, polish, art, docs and tests.
- **minor**: anything new, and anything that changes a data or pack format (while we are below 1.0 a breaking change is a minor). A changed vorld format also raises `DATA_SCHEMA` and adds a migration in `engine/server/schema.mjs`; see [docs/UPGRADING.md](docs/UPGRADING.md).
- **1.0.0** is for a stable release and is only ever given exactly: `npm run bump -- 1.0.0 "..."`.

A pre-commit check enforces it. Turn it on once in your checkout: `git config core.hooksPath .githooks` (`SKIP_VERSION_BUMP=1 git commit ...` skips it once).

## Guidelines

- **Packs before code.** If something can be a YAML setting (a word, a template, a deed, a brain preset), put it in a pack. See [docs/PACKS.md](docs/PACKS.md).
- **No new access paths.** Anything a member does outside their own folder goes through a writ (`engine/server/gate.mjs`).
- **Local first.** No accounts, no telemetry, no hosted services.
- **Plain files.** Vorld data stays readable: YAML, JSON and JSONL.
- **Updates never hurt user data.** Prefer a new optional field with a default over a migration; a migration backs up first and never deletes user files; data from a newer version is never changed.
- **Keep it small.** Open an issue before adding a big feature, so we can agree it belongs in the core rather than in a pack.
