# MySkate Coach

Plans your next figure skating session from a [MySkate](https://github.com/iiSurf/MySkate) backup. Claude reads your log and decides what to practice, for how long, and why. Plain code checks every part of that plan before you see it, and shows MySkate's own suggestion instead when Claude's plan can't be used.

Built with Claude Code for TCSS 490, Artifact 3 ("AI Inside It"). It runs Claude Code headless (`claude -p`) on a Claude subscription sign-in, so it costs nothing beyond Claude Code access and never uses an API key.

## What a run looks like

The first real run, with the made-up skater in `tests/fixtures/backup.json` (Claude Sonnet 5.5, October 23, 2026, about 8 seconds):

```
$ npm run coach -- tests/fixtures/backup.json
Reading backup.json
  10 sessions, newest Thu, Oct 22
Asking Claude for a 60-minute plan for Sat, Oct 24 (sonnet, no tools)
Checking the plan
  ✓ 5 skills, all from the list offered
  ✓ 60 of 60 minutes, in steps of 5
  ✓ every number in the reasons is in your log
  ✓ every focus is in your own words

Sat, Oct 24 · 60 mins
Start with homework edges, then a new mazurka, then jumps and spin for the Fall
Classic.

1. Backward crossovers to a backward outside edge glide · 5 min
   Homework due Mon, Oct 26; already earned at 4 stars, so a short run
   Focus: "3 sets of back crossovers each way before every session"
2. Mazurka · 10 min
   Not tried yet, and the coach's homework is due Sat, Oct 31
   Focus: "Try the mazurka on both sides, slowly"
3. Two forward crossovers into a forward inside mohawk, step down and cross
   behind, one backward crossover, step to a forward inside edge · 10 min
   In your Fall Classic program, still at 3 stars and needs work
4. Waltz jump · 20 min
   Goal is 4 stars by Nov 15, now 3; landed 4 of 12 Thursday
   Focus: "Bend the knee and check the landing for a count of 3"
5. One-foot upright spin · 15 min
   Only 2 stars, not practiced in 16 days, and it's in your Fall Classic program
   Focus: "Find the ball of the foot, arms in slowly"

Saved plans/2026-10-24.md
Run log: runs/2026-10-23-225952.json
```

When a check fails, you see it, and Claude gets one more try with the list of problems (this one is from the tests, where a stand-in plays Claude with a reply whose minutes add up to 65):

```
Checking the plan
  ✗ The minutes add up to 65, not 60.
Asking Claude again with 1 problem
Checking the plan
  ✓ passed on the second try
```

## How it works

1. **Read** (code). Finds your newest MySkate backup in the coach's `backups` folder and reads it with MySkate's own code, which cleans every field. A locked backup is unlocked with your passphrase, which is never kept.
2. **Brief** (code). Works out numbered facts from the backup with MySkate's own numbers (D1 the day, R1 to R5 your recent sessions, H your homework, G your goals, T1 your test, E1 your next competition, and one S fact for each skill you could practice), plus the list of skills Claude may pick from.
3. **Plan** (Claude). One `claude -p` call with the brief, Claude's instructions (`prompts/coach.md`), and the reply's shape (`prompts/reply.schema.json`). Claude has no tools: it can only read the brief and answer with one JSON reply.
4. **Check** (code). `lib/check.js` checks everything the reply says (see the table below) and lists every problem at once.
5. **Retry or fall back** (code). A plan that fails goes back to Claude once, with the list of problems. If it fails again, or Claude Code itself can't answer, you get MySkate's own suggestion, labelled as such, with the reason.
6. **Show and save** (code). The plan goes to your terminal and to `plans/<day>.md`. Every run is logged in `runs/`.

## What Claude does and what the code checks

| | Who decides | What the code checks |
|---|---|---|
| Reading the backup, and every number about your skating | The code, with MySkate's own code (`sanitizeState`, `skillStats`). Claude never sees the file. | MySkate's own cleaning, and the tests in `tests/brief.test.js` |
| Which skills Claude may pick | The code: your homework, goals, the next competition's program, your levels, your test, what you practiced in the last 60 days, and the next level (at most 60) | |
| Which skills to practice, and in what order | **Claude** | Each is one of those offered, each only once, 2 to 6 of them (fewer for short ice times) |
| How many minutes each gets | **Claude** | Whole minutes, in steps of 5, at least 5 each, adding up exactly to your ice time |
| Why each skill is in the plan (one short line) | **Claude** | It cites 1 to 4 real facts, each about that skill or about the whole session; every number in it appears in the facts it cites; one line, at most 90 characters |
| A focus to remember for each skill | **Claude** picks the words | Copied word for word from your own cue, notes, or homework for that skill, or left empty. Claude never gives technique advice: that's your coach's job |
| A one-line summary | **Claude** | At most 140 characters; every number in it appears somewhere in the facts |
| Whether the plan is wise (homework first, nothing neglected for weeks, a mix of skills) | **Claude**, from its instructions | Not checked by code. You, and your coach, are the last check |
| What happens when a check fails | The code | One retry with the list of problems, then MySkate's own plan, labelled, with the reason |
| How Claude is run | The code (`lib/claude.js`, the only code that talks to the model) | Subscription sign-in only, no API key, no tools, nothing loaded from settings, an empty working folder, a 3-minute limit |

## What is sent to Claude

- **Sent:** your levels; the day and length of the session; the dates and lengths of your last 5 sessions and a 4-week total; for each skill on the list: its ratings, landings, when you last practiced it, MySkate's own pick, and your cue and two latest notes on it; your open homework and goals; your test and its date; your next competition within 60 days and the skills in its program.
- **Never sent:** your name, friends, costs, rinks and ice times, blades, badges, settings, or anything else in the backup. A test checks this.
- To see exactly what would be sent: `npm run coach -- --brief`.

## What the coach touches on your Mac

The coach works only inside your workspace: the folder that holds MySkate and MySkate Coach (`~/Documents/claude-workspace`). It never looks in Downloads, iCloud Drive, your Desktop, or anywhere else, and the tests check this.

- **Reads:** the newest `myskate-backup-*.json` in `backups/` (or a backup you name, which must be inside the workspace), and MySkate's code and skill lists in `../MySkate`.
- **Writes:** your plan to `plans/`, the run log to `runs/`, and an empty folder in `.run/` for each Claude Code run, removed after.
- **Outside the workspace, only Claude Code itself:** the coach runs Claude Code from where it is installed (the copy inside the Claude desktop app, or `claude` if you installed it), and Claude Code keeps its sign-in in the macOS Keychain and its settings in a hidden `.claude` folder in your home folder, the same places the Claude desktop app already uses.
- **Claude, the model, gets no tools,** so it cannot open, read, or upload any file anywhere. It only reads the brief the coach hands it.

## Cost

- It runs on Claude Code with your Claude subscription sign-in, the same access you use Claude Code with. No API key.
- In headless mode an API key would win over your sign-in and be billed per call, so the coach leaves `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, and the cloud-provider switches out of Claude Code's environment, and refuses to run unless `claude auth status` says the sign-in is a Claude subscription.
- A run is one call to Claude, or two when the first plan fails a check. Runs count toward your plan's usage limits. The first real run was one call: about 5,300 tokens in and 1,100 out, by Claude Code's own count.
- The run log keeps Claude Code's own cost estimate. On a subscription that is an estimate at list price, not a charge. The one way a subscription can be charged is extra usage beyond the plan's limits, if your account has it turned on.

## Setup (once)

1. Node 20 or newer (tested on Node 22). Nothing to install with npm: there are no dependencies.
2. MySkate in the folder next to this one, so `../MySkate` exists: `git clone https://github.com/iiSurf/MySkate`. Or set `MYSKATE_DIR` to where it is.
3. Claude Code. Nothing to install if you have the Claude desktop app: the coach uses the copy inside it. (Or install the `claude` command: `curl -fsSL https://claude.ai/install.sh | bash`, [setup](https://code.claude.com/docs/en/setup).)
4. `npm run signin` signs Claude Code in with your Claude account (it opens your browser). It uses the subscription sign-in, never an API key.

## Use

1. In MySkate: Profile, then Save a backup. Move the file into this folder's `backups` folder (the coach never looks anywhere outside the workspace, so moving it is up to you).
2. On your Mac, in this folder: `npm run coach`.
3. At the rink: open MySkate's Plan and tick the skills in the plan (the minutes are the coach's suggestion).

Options:

```
npm run coach -- path/to/backup.json   use this backup instead of the newest (it must be inside the workspace)
npm run coach -- --slot 45             your ice time in minutes (15 to 180, in steps of 5; default: your usual)
npm run coach -- --today               plan today's session (default: tomorrow), or --date 2026-10-24
npm run coach -- --brief               show what Claude would be given, and stop
npm run coach -- --myskate             MySkate's own suggestion, without Claude
npm run coach -- --model opus          another Claude model (default: sonnet)
```

## When something goes wrong: was it Claude or the code?

The exit code says which part failed:

| Exit code | Meaning |
|---|---|
| 0 | Claude's plan passed every check |
| 1 | What was given: no backup, an unreadable one, a wrong passphrase, or a bad option. The message says which |
| 2 | Claude Code is missing, or not signed in with a Claude subscription |
| 3 | Claude's plan couldn't be used, so MySkate's own plan was shown: it failed the checks twice, or Claude Code itself failed (a usage limit, too slow) |
| 4 | A bug in MySkate Coach itself, not Claude |

Every run writes `runs/<time>.json`: the brief, each prompt, what Claude Code printed, Claude's reply, the problems the checker found, and the result.

- If a reply in the log breaks a rule, Claude made the mistake, and the checker caught it.
- If an attempt has an error and no reply, Claude Code failed (sign-in, usage limit, timeout), not the plan.
- If a reply is fine but the checker refused it, or the plan shown doesn't match the reply, the code is wrong. Copy that reply into `tests/fixtures/replies/` and write a test for it.

## Known limits

- The number check makes sure every number in a reason appears in a fact the reason cites. It catches made-up numbers, not every mix-up: "not practiced in 2 weeks" passes for a skill whose last ratings include a 2.
- Claude's priorities aren't checked by code, only its facts, numbers, skills, and minutes.
- A plan is only as good as the backup. The coach warns when your newest session is more than 2 weeks old.
- MySkate doesn't open the plan by itself: you tick the skills on its Plan screen.
- Tested on macOS with Node 22.

## Tests

```
npm test
```

The tests never call Claude: `tests/fake-claude.mjs` stands in for Claude Code with recorded answers. They cover the backup reader, every fact in the brief, every check (with replies that break each rule), the Claude Code runner (its environment, its arguments, how it reads answers and failures), the retry and fallback, and the whole command run as a real process.

## Files

- `coach.mjs`: the command.
- `lib/claude.js`: the only code that talks to Claude.
- `lib/check.js`: every check on Claude's reply.
- `lib/brief.js`: the facts and the list of skills Claude is given.
- `lib/pipeline.js`: the retry, the fallback, and the run log.
- `lib/fallback.js`: MySkate's own plan.
- `lib/backup.js`, `lib/myskate.js`: finding and reading the backup with MySkate's own code.
- `lib/format.js`, `lib/dates.js`: laying out the plan.
- `prompts/coach.md`, `prompts/reply.schema.json`: Claude's instructions and the shape of its reply.
- `tests/`: the tests, the stand-in for Claude Code, and a made-up backup.
- `LOG.md`: what was planned and what changed. `CLAUDE.md`: guidance for working on this repo with Claude Code.
