# Upgrading OpenVorld

Updating OpenVorld replaces the program, never your data. Your vorlds, chats, writs and keys live in your data folder (`~/.openvorld`, or the folder you chose with `OPENVORLD_HOME` or **File → Choose Data Folder…** in the desktop app), outside the app and outside this repository. The desktop app and the Node project share that folder by default.

## Update

**Desktop app (macOS from source):** close OpenVorld, pull the new code, then

```bash
git pull && npm install && npm run desktop:install
```

The installer swaps the app in `~/Applications`, keeps your data folder setting, keeps a copy of the previous app (the two newest are kept, older ones are removed), and opens the new one. Packaged installers (`npm run desktop:dist`) replace the app the usual way; your data folder is not part of them.

**Node project:**

```bash
git pull && npm install && npm run build
```

then start it again (`npm run dev` or `npm start`). Nothing in your data folder or in `.openvorld-dev.json` is part of the repository, so a `git pull` cannot clash with it. Put your own packs in `~/.openvorld/packs` (or `<vorld>/packs`), not in this repository's `packs/` folder: that folder is replaced by updates, and your packs layer over it.

## What happens to your data

Every vorld has a data format number (`schema` in its vorld.yaml), separate from the app version. At start-up:

- **An older vorld** is brought up to date. Its vorld.yaml is copied to `<vorld>/backups/vorld-schema<N>-<time>.yaml` first, the migration only adds or renames fields, and nothing else in the vorld (chats, parties, houses, workbenches, your project folder) is touched or deleted. The server prints what it did.
- **A newer vorld** (saved by a newer OpenVorld than the one you are running) is never opened or changed. It shows on the title screen as unavailable; update OpenVorld to open it. This is what protects your data if you go back to an older version or share a data folder between two installs.
- vorld.yaml and grants.yaml are written to a temporary file and renamed, so a crash or a full disk never leaves half a file.
- To go back to an older version, install it again; vorlds migrated meanwhile can be restored from `backups/` (copy the backup over vorld.yaml while the app is closed).

## Your own packs and art

Packs layer over the built-in ones, so a user pack changes only what it names. When the built-in format of something changes, [CHANGELOG.md](../CHANGELOG.md) says so under that version, and `npm run validate` checks your packs.

- **Character sheets** made for the old layout (four directions, three frames) keep working: a missing diagonal borrows the nearest side view and the short walk is looped. Redraw them as eight directions with four walk frames to get the new look; see `packs/core/art/default/LAYOUT.md`.
- Sheets can have any resolution: cells are cut by the sheet's width.

## Versions

OpenVorld follows `major.minor.patch` and every commit bumps it (see [CONTRIBUTING.md](../CONTRIBUTING.md#versioning)). Below 1.0, a **minor** bump (0.3 → 0.4) means something new or a changed format, so it is worth reading the CHANGELOG entry; a **patch** bump (0.3.0 → 0.3.1) is a fix, polish, art or docs. A change to the data format also raises the format number in `engine/server/schema.mjs` and adds a migration there.
