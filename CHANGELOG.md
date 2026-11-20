# Changelog

Every commit bumps the version (see [Versioning](CONTRIBUTING.md#versioning)): patch for fixes, polish, art and docs; minor for anything new or a changed data or pack format. Upgrading is covered in [docs/UPGRADING.md](docs/UPGRADING.md).

## 0.19.5 - 2026-11-20

- Cover the active direct chat deletion guard and verify that deletion removes the log and uploads after the reply finishes.
- Keep the demo guide beside the chat so it leaves room for the composer in short windows.

## 0.19.4 - 2026-11-20

- Right-to-left text in chats and party rooms; chat tabs with delete (the chat's log and attachments are removed, a party's shared folder stays); a chat cannot be deleted while it is working or uploading

## 0.19.3 - 2026-11-20

- The member panel no longer shows the job description (more room for the chat); a new agent always keeps its own workbench, and the optional Initial folder you pick in the New agent dialog becomes an extra workbench its chats start on; a chat's workbench list no longer shows the agent's own workbench as a choice: None means only its own workbench, then the agent's folders, and Add folder adds one to the agent's folders

## 0.19.2 - 2026-11-20

- Removed the Looks like dropdown from onboarding and the companion's settings: it never changed the companion's art, only how it moves

## 0.19.1 - 2026-11-20

- Crew walking to you no longer cut through props, the Party Hall's pillar or house walls: the walking test now knows everything you bump into, so routes go around it

## 0.19.0 - 2026-11-20

- Parties get a shared folder (parties/<id>/shared) that is kept after the party: files the founder attaches, pictures from tools and files a member names in share are copied there, the room says who shared what and where, every member reads it with its own tools, and an Open folder button shows it

## 0.18.1 - 2026-11-20

- Chats no longer jump to the end while you read older messages: new messages follow you down only when you are near the end, and sending a message always goes to the end

## 0.18.0 - 2026-11-20

- Chats: a button in the chat header makes the member chat or party room wider (up to 70% of the screen); the choice is kept in this browser

## 0.17.0 - 2026-11-20

- Parties: @all (or @everyone, @team, @crew) in your message gives every member a turn, in party order; it completes in the composer and shows how many will answer; a writ in the middle keeps the others waiting

## 0.16.3 - 2026-11-20

- Pages with very large response headers (Google, YouTube) load in the crew browser: pages now load natively and redirects are checked inside Chrome, popups included

## 0.16.2 - 2026-11-20

- A crew member can close its own browser when it is done (new browser_close tool for every brain); it stays open if you are using the window

## 0.16.1 - 2026-11-20

- The in-app browser window sits on a real backdrop again (it had the wrong class, so it had no close button in reach), and the member panel can close a member's browser

## 0.16.0 - 2026-11-20

- The crew browser opens inside OpenVorld: expand a member's live preview, click, scroll and type in it, and sign in to a site without a separate Chrome window (your sign-in is saved for that member). A CAPTCHA or login wall now shows a "needs you" note on the balloon. Your window never loosens the member's own writs, and the browser keeps its honest OpenVorld/1 name

## 0.15.1 - 2026-11-19

- Windows: the crew browser tools reach Claude Code members again (its system prompt was passed as a multi-line argument, which cmd.exe cut off together with --allowedTools; it now comes from a temporary file), and Chrome or Edge are found per user and in any Program Files folder

## 0.15.0 - 2026-11-19

- Every brain can use the crew's tools: Antigravity, OpenCode and any command harness with mcp_args get the browser, secret_ask and recall over the bridge

## 0.14.4 - 2026-11-19

- The launch token is no longer passed to brain processes or the engine's run_command (only the per-turn bridge token reaches a brain)

## 0.14.3 - 2026-11-19

- Security: the tool bridge no longer gets the launch token (which opens the whole API and can be read by the brain from a config file, its arguments or its environment); it gets a token for one member's one turn that opens only that member's own tools and stops when the turn ends

## 0.14.2 - 2026-11-19

- Web demo on the current version, playing about 40% slower (one PACE setting); Mira's first note shows crew memory; the integration prompt button hides where there is nothing to copy

## 0.14.1 - 2026-11-19

- Copy integration prompt: one minimal button instead of showing the prompt, and the prompt now covers installing the AI's command-line tool (and what it needs) when it is missing

## 0.14.0 - 2026-11-19

- Brains on every platform: CLIs start through cross-spawn, so Windows .cmd shims (claude.cmd, codex.cmd ...) are found and run; a pack can point a known CLI to a full path; a generic command driver lets any other agent harness be a brain; and "Your AI isn't in the list?" gives a message to copy into your own AI so it adds itself

## 0.13.2 - 2026-11-19

- Deed, level and error toasts are readable again: their kind class no longer picks up the faded style of locked deeds (or the red error text)

## 0.13.1 - 2026-11-19

- Crew memory polish from a live run with Claude Code and Codex: recall reads as a search for every brain, and a search leaves out the chat that asks

## 0.13.0 - 2026-11-19

- Crew memory: each member keeps a notebook between chats (remember and forget in the ov block), a summary of every chat (the latest few start a new chat) and a recall tool to search and reread older chats; the founder reads, edits and removes it in the member's settings

## 0.12.2 - 2026-11-19

- Branch and pull request rules in CONTRIBUTING.md, plus a pull request template

## 0.12.1 - 2026-11-19

- Party chat tooltips ("Chat with {name}", and the leader's) come from the theme pack instead of hard-coded English

## 0.12.0 - 2026-11-19

- Open a crew member's own chat by clicking their portrait or name in a party chat; the party room keeps its chat, scroll and draft, and Escape or Close returns to it

## 0.11.12 - 2026-11-19

- Codex can write a folder granted by an fs.write writ when it is not the chat's working folder (the sandbox stayed read-only and the folder was dropped)

## 0.11.11 - 2026-11-17

- Fix the Copy button on code blocks in the desktop app, which denied the clipboard write; fall back to a selection copy where the Clipboard API is missing

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
