# Changelog

Every commit bumps the version (see [Versioning](CONTRIBUTING.md#versioning)): patch for fixes, polish, art and docs; minor for anything new or a changed data or pack format. Upgrading is covered in [docs/UPGRADING.md](docs/UPGRADING.md).

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
