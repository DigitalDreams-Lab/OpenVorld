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

Artifacts are written to `release/`. On macOS the app is in `release/mac-arm64/OpenVorld.app` (Apple Silicon) or `release/mac/OpenVorld.app` (Intel). Builds produce ZIP on macOS, an NSIS installer on Windows, and AppImage on Linux. The desktop-build workflow builds each on its own operating system.

### Releases

The **Desktop builds** workflow (Actions tab → *Run workflow*, or pushing a version tag) builds Apple Silicon and Intel macOS apps, Windows x64 and Linux x64. Each release contains exactly four desktop downloads plus the matching changelog entry. Update manifests stay in CI artifacts and the separate `updates` branch. Published binaries are immutable; a retry can finish publishing the feed only when the downloaded release files match the verified build artifacts. A pushed tag must match `package.json`. Untick *Publish the builds as a GitHub release* to only build.

Local development builds use an ad-hoc signature. Public Mac releases require Developer ID Application signing, Hardened Runtime and Apple notarization. The build verifies the signature, version, architecture, stapled ticket and Gatekeeper acceptance before uploading artifacts. Missing signing credentials fail the public build rather than publishing an ad-hoc app. Windows releases should also be signed. Signing credentials are not included in the repository.

The workflow requires repository secrets `MAC_CERTIFICATE` (base64 P12), `MAC_CERTIFICATE_PASSWORD`, `MAC_SIGNING_IDENTITY` (Developer ID Application identity), `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, and `APPLE_TEAM_ID` to sign and notarize both Mac builds. Optional `WIN_CERTIFICATE` and `WIN_CERTIFICATE_PASSWORD` sign Windows installers. For local distribution builds, `npm run desktop:release` also accepts an existing signing identity and `APPLE_KEYCHAIN_PROFILE` for notarization credentials stored in Keychain.

## Install a release

- **macOS:** download the ZIP for Apple Silicon or Intel, double-click to extract it, and drag OpenVorld into Applications. A signed, notarized build is required for normal Gatekeeper acceptance.
- **Windows:** open the x64 EXE and follow the installer. Installation is per-user and does not require Node.js.
- **Linux:** download the x64 AppImage to a writable folder, enable “Allow executing file as program” in file properties, and open it. Some distributions need FUSE support. Keep the AppImage in that writable folder for in-app updates.

## Updates and changelog

Installed releases check GitHub after startup and every six hours. **Help → Check for Updates…** checks immediately; **Help → Check for Updates Automatically** disables periodic checks and downloads. Requests contain normal network metadata, with no worlds, conversations, provider keys, or telemetry sent. Source launches never check automatically.

Windows installers and Linux AppImages download stable updates in the background, validate the release manifest's SHA-512 checksum, and show the version's changelog before offering **Restart and Install**. Choosing **Later** leaves the update ready in the Help menu; ordinary quitting does not install it. Restart uses the existing engine shutdown flow, including confirmation before stopping active agents. Worlds and settings stay outside the installed app.

Developer ID signed Mac builds use the same flow. Ad-hoc Mac apps, unpacked Linux builds, and unsupported architectures show the release notes and open GitHub for an installer instead. An existing version without the updater needs one manual upgrade before it can check for future updates. **Help → What’s New** also works offline using the installed version's bundled changelog.

Update channels include the CPU architecture (`latest-arm64` / `latest-x64`), so the two Mac manifests cannot overwrite one another. Starting with 0.11.0, the generic feed at `https://raw.githubusercontent.com/DigitalDreams-Lab/OpenVorld/updates` points to complete desktop downloads on GitHub. Full downloads avoid exposing blockmaps as release assets. The release workflow checks installer hashes, publishes all four binaries, then atomically advances the feed. Feed publication rejects version rollback. Versions before 0.11.0 need one manual upgrade to adopt the separate feed.

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
