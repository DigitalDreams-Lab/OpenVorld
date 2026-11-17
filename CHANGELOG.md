# Changelog

Every commit bumps the version (see [Versioning](CONTRIBUTING.md#versioning)): patch for fixes, polish, art and docs; minor for anything new or a changed data or pack format. Upgrading is covered in [docs/UPGRADING.md](docs/UPGRADING.md).

## 0.11.10 - 2026-11-17

- Drop the removed quests from the package description

## 0.11.9 - 2026-11-17

- Keep About and Changelog open for clicks inside the dialog; dismiss only for clicks starting and ending on the backdrop

## 0.11.8 - 2026-11-17

- Add a Changelog tab to About, with current and previous release notes in the desktop menu and Settings.
- Keep the companion visible in a nearby clear spot, preferring the space above the founder.

## 0.11.7 - 2026-11-17

- Restore close-range interactions and original collisions; add a small stopped-following gap and prevent obstacle route searches from blocking animation

## 0.11.6 - 2026-11-17

- Fix folder picker cancellation, party gathering, mention suggestions, follower spacing, party navigation and update menu placement

## 0.11.5 - 2026-11-16

- Route party balloons to group room, add dismiss button, increase gathering spacing, and add browser screenshots

## 0.11.4 - 2026-11-16

- Describe OpenVorld as an open-source harness for AI agents in the README and package description

## 0.11.3 - 2026-11-16

- Sign and notarize the Mac desktop releases with the correct Developer ID identity selector.
- Keep four desktop downloads, with changelog and full-installer updates served through a separate feed; versions before 0.11 need one manual upgrade.
- Include the Canvas fallback for Macs without WebGL and the fix for agent CLIs that close their input early.

## 0.11.2 - 2026-11-16

- Handle agent CLIs that close their input pipe early, preserving their JSON responses and authentication errors instead of crashing with EPIPE.
- Fall back to Canvas rendering on Macs without WebGL, and verify that path in the Intel Mac release smoke test.

## 0.11.1 - 2026-11-16

- Allow slower CI Macs time to render the first world and retain smoke-test screenshots, renderer errors and GPU diagnostics when a packaged app fails.

## 0.11.0 - 2026-11-16

- Require Developer ID signing, notarization and Gatekeeper acceptance before publishing Mac apps.
- Keep releases to four desktop downloads and move architecture-specific update metadata to a separate feed; older versions need one manual upgrade.
- Download complete verified installers without public blockmaps and smoke test both packaged Mac architectures.

## 0.10.2 - 2026-11-16

- README: the web demo as a GIF at the top, and the one minute promo video.

## 0.10.1 - 2026-11-16

- Keep installer builds working when optional signing certificates are not configured
- Include automatic desktop update checks, release notes, and platform installers in this first updater-enabled release

## 0.10.0 - 2026-11-16

- Add desktop update checks, background downloads, release notes, and safe restart-to-install with installer fallback for unsigned Macs
- Publish Apple Silicon and Intel Mac installers, Windows and Linux builds, and architecture-specific update metadata together

## 0.9.2 - 2026-11-16

- Demo attract mode (play/?embed&attract) for the website's hero: the story plays itself silently on a loop, and tells the page when it is on screen and when it has finished

## 0.9.1 - 2026-11-16

- Demo embed mode (play/?embed) for the website's hero: smaller menus, the map leads, the chat opens on request, and balloons stay above the tips

## 0.9.0 - 2026-11-16

- Add a playable web demo, Surprise for Buzz: the real client with an in-browser scripted engine, built from data the real engine makes (npm run demo:build, output release/demo)
- Fix crew members stretching tall for a moment when they read, browse, bow or shrug: reactions now squash relative to their normal size and always end at it

## 0.8.2 - 2026-11-16

- The Send a test message explains the usual reason a banner does not show: macOS holds banners while the display is asleep (they wait in Notification Center) or a Focus mode mutes them

## 0.8.1 - 2026-11-16

- Serve large character sheets as small lossless pages and load portraits independently to avoid invisible characters on Windows
- Report artwork loading failures, verify packaged Windows portraits in the release workflow, and fix the development browser favicon path

## 0.8.0 - 2026-11-16

- Use the existing OpenVorld icon consistently across startup, Settings, About and the favicon, retaining the original native desktop icon
- Refresh the README with real demo screenshots and add a repeatable screenshot and branding check

## 0.7.1 - 2026-11-15

- The model-endpoint row in Settings lines up: the key box and the 'Forget key' button sit on one line next to the address, apart from the endpoint's own Remove

## 0.7.0 - 2026-11-16

- Add shared founder name and About me settings, with the main character kept fixed
- Return characters upright after work reactions and interrupted animations
- Enable isolated HTML and media previews in the desktop app and add desktop preview and profile smoke checks

## 0.6.2 - 2026-11-15

- Speech balloons (a call over, a line a character says) are drawn with the job balloons and stack above them, newest on top, each joined to its character, instead of hiding under the job balloon; a tall stack keeps the newest lines

## 0.6.1 - 2026-11-15

- The desktop workflow publishes a GitHub release for the version (tag v<version>, files named OpenVorld-<version>-<os>-<arch>, SHA256SUMS.txt, the changelog entry as notes) every time it is run; a pushed tag must match the version

## 0.6.0 - 2026-11-15

- API keys: paste the key itself in Settings (kept on this computer, never in the vorld file, a chat or an error) or name an environment variable; a key typed in the variable-name box is moved out and scrubbed from chats; + openai-compatible for any address

## 0.5.0 - 2026-11-15

- Images show in chat messages (links to pictures render under the paragraph); a link to a file outside the chat's folders offers 'Allow this file for this session'; Codex keeps its write access after a writ is granted (resumed sessions got no sandbox settings) and the pictures it generates land in the reply; file previews open from links

## 0.4.0 - 2026-11-15

- Agents can call and send home: summon, gather and send_home now work for agents on themselves and their party (also as call / back_to_work); the companion stays the admin who can reach the whole crew

## 0.3.3 - 2026-11-15

- Several balloons no longer pile on each other: they stack (compact, stemmed to their character, spilling under the group when there is no room above), and a balloon placed below a character sits under its feet instead of over it

## 0.3.2 - 2026-11-15

- Writs live in each agent's settings (expandable, revocable per agent); Send a test now says what happened and the chime is louder; toasts show above dialogs

## 0.3.1 - 2026-11-15

- Fix a chat that switched brains: a session is resumed only by the brain it came from, a lost session starts fresh with the conversation so far (no more 'no rollout found'), and an error is no longer shown twice

## 0.3.0 - 2026-11-15

The version line starts again at 0.3.0 (OpenVorld is not at 1.0 yet).

- **Updating is safe.** Vorld data now has its own format number (`schema` in vorld.yaml). Older vorlds are brought up to date at start-up after their vorld.yaml was copied to `<vorld>/backups/`; a vorld saved by a newer OpenVorld is never opened or changed. vorld.yaml and grants.yaml are written atomically. Custom character sheets made for the old four directions and three frames still work.
- **Eight-direction characters** with a four-frame walk cycle (legs and arms move) and a wing-flap cycle for Buzz, redrawn with Codex image generation; sharper world, building and avatar art.
- **Parties, houses, vaults and workbenches**: named groups chatting in one shared room; a private house and vault per member; several workbenches per member, chosen per chat under the message box.
- **Notifications**: members walk over and ask for access in a balloon over their head; a chime when someone needs you, desktop notifications while the window is in the background, a title badge, and a silent crew otherwise.
- **Desktop app** for macOS, Windows and Linux (`npm run desktop`), with the same local engine.
- UI polish: Lexend headings, roomier settings, icon buttons, a follow/dismiss button, a clearer Brain list.
