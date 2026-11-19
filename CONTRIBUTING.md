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

## Branches and pull requests

Nobody commits straight to `main`. Every change goes through a branch and a pull request.

1. **Branch from the latest `main`**, named by kind: `feat/<name>` (new behaviour), `fix/<name>`, `docs/<name>` or `chore/<name>` (tooling, tests, cleanup). Example: `feat/crew-memory`.
2. **One topic per pull request.** Keep it small. Split a big change into steps that each work on their own, and leave unrelated formatting, renames and refactors for a PR of their own.
3. **Agree on features first.** A new feature starts as an issue (see [Guidelines](#guidelines)). Link it in the description, for example `Closes #12`.
4. **Open it as a draft** while you work, and mark it ready for review when all of these hold:
   - it is rebased onto the newest `main`;
   - the checks pass: `npm test && npm run typecheck && npm run validate`;
   - every commit bumps the version (see [Versioning](#versioning)). If `main` moved on, bump again above the newest version when you rebase;
   - the docs say what changed (README, `docs/` or this file), when it is something a user or contributor needs to know.
5. **Write a clear description**, using the template GitHub fills in: what changed and why, how you tested it (the commands, and what you checked by hand in the app), and screenshots for anything visible.
6. **During review**, answer comments in the PR and push new commits. Force-push only to rebase onto `main`.
7. **Merging** is done by a maintainer, with a merge commit (no squash), so each commit must pass the checks on its own. The branch is deleted after the merge.

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
