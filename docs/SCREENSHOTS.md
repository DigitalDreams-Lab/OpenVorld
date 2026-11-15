# Product screenshots

The README images are captures of the running app, using an isolated **Launch Studio** demo world with an illustrative conversation and a real HTML brief. No paid models run, and no personal worlds, credentials, or project folders are used. The activity balloon is a sample live event rendered through the normal app event handler. Crew members use normal movement commands to stand at separate places, keeping names clear of other characters.

To regenerate them from the repository root:

```bash
npm run screenshots
```

The script writes PNGs to `docs/images/`, checks the startup and Settings icons, opens About from both locations, and verifies that closing About preserves Settings. The same SVG in `desktop/assets/icon.svg` supplies the app's interface icon, favicon, and README mark; `desktop/make-icons.mjs` produces its native desktop counterparts.

Review every capture before publishing. Keep the full interface, use readable text, and avoid personal paths, credentials, private conversations, and screenshots that imply a model ran when it did not. Demo worlds and temporary desktop preferences are removed when the script exits.
