# Desktop app

OpenVorld's Electron app runs the same React/Phaser interface and local Node engine as browser mode. It starts its own engine on a free loopback port and bundles the runtime, packs, and built interface. Users do not need to install Node to launch the app. Agent CLIs and Chrome/Edge for crew browsing remain separate installations.

## Run from source

```bash
npm install
npm run desktop
```

If npm blocks Electron's download script, run `node node_modules/electron/install.js` once. `npm run desktop` builds the interface before launching; use `npm run dev` for browser development with hot reload.

## Build installers

```bash
npm run desktop:pack       # unpacked app for this computer
npm run desktop:dist       # installers for this platform
```

Artifacts are written to `release/`. On macOS the app is in `release/mac-arm64/OpenVorld.app` (Apple Silicon) or `release/mac/OpenVorld.app` (Intel). Builds produce DMG/ZIP on macOS, an NSIS installer on Windows, and AppImage on Linux. The desktop-build workflow builds each on its own operating system. Windows and Linux builds still need platform-specific end-to-end validation.

### Releases

The **Desktop builds** workflow (Actions tab → *Run workflow*, or pushing a tag like `v0.6.0`) builds macOS, Windows and Linux and then publishes one GitHub release named after the version in `package.json`: tag `v<version>`, the files named `OpenVorld-<version>-<os>-<arch>.<ext>`, a `SHA256SUMS.txt`, and the matching `CHANGELOG.md` entry as the notes. Running it again for the same version replaces the files. A pushed tag must match the version (`v0.6.0` for `0.6.0`), or the run stops with a message. When running it by hand, untick *Publish the builds as a GitHub release* to only build.

The default Mac build uses an ad-hoc signature for local use. Public distribution needs an Apple Developer ID signature and notarization; Windows releases should also be signed. Signing and automatic updates are not configured by this local setup.

## Install on your Mac

```bash
npm run desktop:install
```

This builds the app, installs it into `~/Applications/OpenVorld.app`, registers it with Launch Services, and opens it. No sudo is needed. Close an existing OpenVorld desktop app before reinstalling. An existing installation is preserved as a hidden timestamped backup beside it.

On first installation from this checkout, the installer reuses the data folder in `.openvorld-dev.json` when one exists. To select a specific existing folder after building:

```bash
node desktop/install-mac.mjs --home /absolute/path/to/openvorld-data
```

Worlds stay in their original location. The installer does not copy or migrate them.

## Data and lifecycle

- By default desktop and browser mode share `~/.openvorld`.
- An explicit `OPENVORLD_HOME` environment variable overrides desktop settings. Source launches also respect `.openvorld-dev.json` when no desktop data folder has been selected.
- **File → Choose Data Folder…** selects another folder and restarts the app. This keeps each folder's worlds in place.
- Preferences live in Electron's per-user `OpenVorld/desktop.json` directory (`~/Library/Application Support/OpenVorld/desktop.json` on macOS).
- **File → Open Data Folder** and **Help → Open Logs Folder** open their locations.
- On macOS, closing the window leaves the engine running; click the Dock icon to reopen it. **OpenVorld → Quit OpenVorld** (⌘Q) stops it. On Windows and Linux, closing the last window quits.
- Quitting with active agent runs asks before stopping them. Graceful shutdown aborts runs, finishes their saved transcripts, and closes crew browser sessions before exiting, with a bounded fallback if a process does not respond.
- The app uses its own free port, so an existing browser-mode server can stay running. Avoid editing the same world from both instances at once.

## Implementation

`desktop/main.mjs` owns windows, menus, navigation restrictions and engine lifecycle. The renderer is sandboxed, with Node integration disabled and context isolation enabled. It communicates with the authenticated local engine through the existing HTTP/WebSocket API; it has no Electron preload privileges. External web links open in the system browser.

The engine runs with Electron's bundled Node runtime in a separate process. Browser MCP bridges also use that runtime. Electron launch flags are removed from agent subprocess environments so installed CLI tools keep launching normally. Data and credentials are excluded from packaging by an explicit source-file allowlist.
