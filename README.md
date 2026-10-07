# ⚔️ TODO Slayer

**Your AI left IOUs in your code. Now they're monsters.**

Paste a public GitHub repo. Every unfinished thing in it spawns a monster. Fix the real code, push, and hit **Rescan**: anything that's gone from your latest commit dies. Git is the referee, not an AI.

Built solo for **Hackyard Yard #4: Gamification** (Oct 5–9, 2026). All code was written during build week.

## The bestiary

| Monster | What it is | Example |
|---|---|---|
| 👺 TODO Goblin | `TODO` in a comment | `// TODO: implement refresh tokens` |
| 👹 FIXME Troll | `FIXME` in a comment | `# FIXME handle null user` |
| 💀 Hack Beast | `HACK` / `XXX` in a comment | `/* HACK: add 5 hours for UTC */` |
| 🧟 Placeholder Zombie | Placeholder language common in AI-assisted code | `// In a real application you would validate this` |
| 🐉 Stub Dragon | Code that claims to exist but doesn't | `raise NotImplementedError`, `throw new Error("Not implemented")` |
| 👻 Silent Exception | Errors swallowed whole | `catch (e) {}`, `except: pass` |

The **oldest** monster in the repo (by `git blame`) becomes the **Final Boss**. Its HP equals its age in days.

## Sound & art

- Hit **🔊 SOUND** in the header. Monsters growl when they spawn. **Click any monster to hear its taunt**, using the browser's own speech engine pitched way down. Kills get synthesized hit and explosion effects, and leveling up plays a fanfare. All audio is generated in the browser: no audio files and no voice API.
- Monster art was generated with ZenCreator (Qwen Image) for this build and lives in `img/`.

## How it works

1. **Scan.** The scanner pins to your branch's latest commit SHA, reads source files from GitHub, and runs deterministic detectors (`api/_detect.js`). A small string-aware parser finds real comments using each language's syntax. As a result, `todoList`, `"https://x.com/TODO"` and a CSS `#TODO` selector never spawn monsters. Vendored and build folders are skipped.
   - Deliberate patterns aren't treated as debt. That covers abstract/interface methods that raise `NotImplementedError`, narrow `except FileNotFoundError: pass` idioms, and swallowed errors that carry an explanatory comment.
   - These rules were tuned against real code (npm's source and Python's standard library) to keep false positives low.
2. **Identify.** Each monster's ID is `file + type + text`, not the line number, so editing code above a TODO doesn't "kill" it.
3. **Verify.** A rescan compares the new commit with the last one. Missing IDs die (HP becomes XP). New ones spawn as reinforcements.
4. **Flavor (optional).** With `OPENAI_API_KEY` set, an LLM writes each monster's name and taunt. It never decides type, difficulty or death.

The detectors find common *patterns*. They don't claim to know whether code was AI-generated.

## Run / deploy

No build step. It's a static `index.html` plus one serverless function.

```bash
npm i -g vercel
vercel dev        # local
vercel --prod     # deploy
```

Environment variables (see `.env.example`):

- `GITHUB_TOKEN`: recommended. It raises GitHub's rate limit from 60 to 5,000 requests per hour and enables monster ages (git blame). Public read access is enough.
- `OPENAI_API_KEY`: optional, for AI monster names and taunts.

Tests: `npm test`

## License

MIT
