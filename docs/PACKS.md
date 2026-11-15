# Packs

Everything the game shows comes from YAML files called packs: the crew's roles, the templates, the deeds, the words, the brains and the map. The engine is the same for everyone, and packs make it yours.

## Where packs live

The engine loads every `*.yaml` file from these three places, in this order:

1. `packs/` in this repo (the defaults)
2. `~/.openvorld/packs/` (yours, for every vorld)
3. `~/.openvorld/vorlds/<id>/packs/` (for one vorld)

Each file has a `kind`, and most also have an `id`. When a later file has the same kind and id as an earlier one, it is **merged** on top of it. That means a user pack only needs the keys it changes. Check your packs with:

```bash
npm run validate
```

## Templates (`kind: template`)

A template is a starting crew plus starter quests. In a quest step, `agent` is a crew member's index in the template's `crew` list (starting at 0).

```yaml
kind: template
id: podcast
label: Podcast
order: 5
description: Plan, script and promote a weekly episode.
crew:
  - { job: Producer, function: "Picks guests and topics and keeps the schedule." }
  - { job: Writer,   function: "Writes show notes and social posts." }
quests:
  - title: Episode notes
    goal: Show notes and three social posts for this week's episode.
    steps:
      - { agent: 0, task: "List the episode's key moments with timestamps." }
      - { agent: 1, task: "Write show notes and three posts from those moments.", seal: true }
```

## Roles (`kind: role`)

There are two roles: `companion`, the guide who can draft quests, and `agent`, which every other member uses. The prompt can use `{name}`, `{job}`, `{function}`, `{voice}`, `{vorld}`, `{about}`, `{crew}`, `{project}` (the shared project folder) and `{workspace}` (the member's private workspace).

```yaml
kind: role
id: agent
prompt: |
  You are {name}, {job} in "{vorld}". Your job: {function}. Speak in {voice}.
```

## Deeds (`kind: achievements`)

A deed unlocks when its `when` condition becomes true. A condition is one of:

- `event:<name>`: the event has happened at least once.
- `count(event:<name>) >= n`: the event has happened at least n times.
- `<counter> >= n`: a counter has reached n.
- `all(...)` or `any(...)`: combines other conditions.

The events are `vorld.created`, `chat.sent`, `chat.night`, `writ.granted`, `writ.refused`, `quest.created`, `quest.done`, `quest.done_5_steps`, `step.done`, `seal.given` and `seal.returned`. The counters are `crew.agents`, `game.level` and `game.xp`. A deed's name and description come from the theme, under `strings.deeds.<id>`.

```yaml
kind: achievements
achievements:
  - { id: busy_week, xp: 120, icon: flame, when: "count(event:quest.done) >= 7" }
```

## Theme (`kind: theme`)

A theme holds the vorld's words and colours: the palette, the companion's name and species, the pool of agent names, the level titles, the building names and every UI string. To restyle every vorld, override `id: default` with a pack in `~/.openvorld/packs`.

```yaml
kind: theme
id: default
companion: { name: Orbit, form: creature, species: owl }
buildings: { quest_board: Mission Board }
level_titles: [Cadet, Pilot, Navigator, Commander]
```

## Brains (`kind: providers`)

This pack lists the brains a member can use. `claude-code` and `codex` run as headless CLIs. `openai-compatible` covers any HTTP API that speaks the OpenAI chat format; you add endpoints in Settings, and API keys are read from environment variables, never saved to disk. To add a preset:

```yaml
kind: providers
providers:
  openai-compatible:
    presets:
      groq: { base_url: "https://api.groq.com/openai/v1" }
```

## Other kinds

| Kind | What it controls |
| --- | --- |
| `interactions` | XP rules, the level curve, how members react to events, and the reply-envelope instructions |
| `permissions` | Writ capabilities (`fs.read`, `fs.write`, `cmd.run`, `net.fetch`), their scopes and never-lists, and the folder picker |
| `scenery` | Map size, moods, biomes, props, houses and labels |
| `default_art` | Which sprite sheet and row each character and tile comes from (`packs/core/art`) |
| `game_commands` | What members can do in the vorld (walk, say, emote), and the panels they can open |
| `icons`, `defaults` | The icon names, the default theme and where the data folder lives |
