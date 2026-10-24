# MySkate Coach log

What was planned and what changed, oldest first. One entry per working step.

## 2026-10-23 (Friday): picking the idea and planning

### Plan

TCSS 490 Artifact 3, "AI Inside It": something where a model does real work every time it runs. Our Claude access covers Claude Code but not the paid Claude API, so whatever it is has to run on Claude Code.

### How the idea was picked

- First round, three shapes: a `claude -p` practice coach that plans the next session from a MySkate backup, an MCP server that lets Claude read the skating log, and a `/lesson` skill that turns a coach's notes into homework.
- The owner asked whether building it could disconnect MySkate's users or lose their data. It cannot: MySkate has no server or accounts, and each person's data stays in their own browser through updates. Only code that reads saved data wrongly, or changes its shape without a migration, could hurt it. A separate repository was recommended anyway, so the live app is not touched at all.
- Second and third rounds added a rink schedule reader, a weekly letter, a week picker, a LOG helper, a score sheet reader, a skill notebook, a program draft, a screen checker, a voice memo log, and an ice pass calculator.
- Finalists: A (practice coach), D (rink schedule reader), E (weekly letter), each drawn as a draft of what you would see. The owner asked me to choose.
- Chosen: A. The model makes one decision whose answer code can check, it is useful before every session, and it fits the "AI skating coach" card. E can be added on top later (same backup reader, facts, and number check). D fits the Artifact 5 idea.

### Decisions

- Its own repository, `MySkate-Coach`, next to MySkate. It reads a copy of a MySkate backup file and never writes into anyone's browser, so MySkate and its users are untouched. (A separate repository separates code, not browser storage: every iisurf.github.io site shares one storage origin. This tool has no web page, so that does not come up.)
- The model runs through Claude Code headless (`claude -p`) on the owner's Claude Code sign-in. No API key: the environment given to Claude Code leaves out `ANTHROPIC_API_KEY`, so a run can never be billed per call. The model gets no tools (`--tools ""`): it can only read what it is given and answer.
- It reuses MySkate's own code from the MySkate folder next to it: `sanitizeState` cleans the backup, `skillStats` gives the numbers, the catalog gives the skill ids, and `suggestNext` with `splitMinutes` makes the fallback plan. The coach and the app never disagree about a number.
- The model's job: pick 2 to 6 skills from the list it is given, the minutes for each, the order, a short reason for each that cites facts by id, an optional focus copied word for word from the skater's own notes, and a one-sentence summary. One JSON reply.
- The code's job: build the facts and the list, check every part of the reply, retry once with the list of problems, then fall back to MySkate's own suggestion, and keep a log of every run so a bad plan can be traced to the model or to the code.
- Sent to Claude: ratings and landings for the listed skills, recent session dates and lengths, open homework, open goals, the test and the next competition, and the skater's own cues and notes for the listed skills. Not sent: the skater's name, friends, costs, rinks, or anything else in the backup.
- MySkate does not change. A one-tap "open this plan in MySkate" link is a possible add-on later, only with the owner's OK.

### Steps

1. Repository, plan, and docs (this entry).
2. Read backups with MySkate's own code: the newest backup in Downloads or iCloud Drive, locked ones too.
3. The brief: the facts and the skills Claude may pick.
4. The checker, tested with recorded replies.
5. The `claude -p` step with one retry, the fallback, and the run log.
6. The whole run tested with a stand-in for Claude.
7. Docs: what the model does and what the code checks.
8. A live run once Claude Code is signed in on the Mac, then the Portfolio card.

### Verified

Nothing yet: this entry is the plan.

## 2026-10-23 (Friday): reading a backup with MySkate's own code

### Plan

Step 2: find the newest MySkate backup and read it the way MySkate does, so the coach never sees anything MySkate would not.

### Changes

- `lib/myskate.js`: finds MySkate (the folder next to this one, or `MYSKATE_DIR`) and loads its modules and its catalog from disk, the same way MySkate's own tests do. Nothing is copied and nothing is written there.
- `lib/backup.js`: the newest `myskate-backup-*.json` in Downloads or iCloud Drive (where an iPhone's Files app saves), read through MySkate's `parseBackup` (which cleans everything with `sanitizeState`). A locked backup is unlocked with MySkate's own `decryptBackup`; the passphrase is asked for and never kept.
- `tests/make-fixture.mjs` and `tests/fixtures/backup.json`: a made-up skater ("Sam", Pre-Free Skate, 10 sessions from Sep 21 to Oct 22, 2026, homework, goals, a test, a competition and its program, a friend, and a rink), built and cleaned with MySkate's own code.

### Verified

`npm test`: 6 tests pass (finding MySkate, the newest backup across folders, reading the made-up backup, a locked backup with the right and wrong passphrase, and MySkate's own messages for files that are not backups).

## 2026-10-23 (Friday): the brief Claude gets

### Plan

Step 3: turn the backup into what Claude is given: numbered facts in MySkate's own numbers, the skills it may pick, and the size of the plan. Send only what the plan needs.

### Changes

- `lib/brief.js`: general facts (D1 the day and the ice time, L1 the levels, W1 the last 4 weeks, R1 to R5 the recent sessions), open homework (H), open goals (G), the test (T1), and a competition in the next 60 days with its program (E1). Then one fact per skill Claude may pick (S1, S2, ...): MySkate's `skillStats` numbers (latest and best stars, the last ratings, landed of tried, when it was last practiced, earned or not), MySkate's own `suggestNext` pick, and the skater's cue and latest notes on it.
- The skills Claude may pick, most pressing first: homework, goals, the competition's program, the skater's levels, the test's skills, anything practiced in the last 60 days, and the next level. At most 60.
- Each fact keeps the numbers in it, for the checker. The skater's own words about each skill (cue, notes, homework) are kept too, so a "focus" can be checked as copied word for word.
- `lib/dates.js`: days as English words ("Thu, Oct 22") without time zone surprises.

### Verified

`npm test`: 16 tests pass. The new ones check each kind of fact word for word against the made-up skater, the order of the skills offered, the limit of 60, a skater with nothing logged, a far-off competition and a past test date, and that the brief never contains the skater's name, a friend, a cost, a rink, the blades, or the friend card id. Read the whole brief for the made-up skater: 32 facts, 19 skills to choose from, about 7,600 characters.

## 2026-10-23 (Friday): the checker

### Plan

Step 4: every check on Claude's reply, in one pure function, with a test for each, before any model is called.

### Changes

- `lib/check.js`, `checkPlan(reply, brief, catalog)`: the reply must be an object with an `items` list and a `summary`; 2 to 6 skills (fewer for short ice times); each skill one of those offered, only once; minutes whole, in steps of 5, at least 5, adding up exactly to the ice time; each reason cites 1 to 4 real facts, each about that skill or about the whole session; every number in a reason is in a fact it cites; a reason is at most 90 characters on one line; a focus is empty or copied word for word (any case, any quote marks) from the skater's own cue, notes, or homework for that skill; the summary is at most 140 characters and every number in it is somewhere in the facts. It lists every problem at once, in order, so one retry can fix them all. It never changes the reply: the plan passes as it is, with each skill's name added.
- Problems are reported at their root: a skill that was not offered, or a reason citing the wrong facts, is reported once, not again for every check that depends on it.
- `tests/fixtures/replies/good.json`: a recorded good reply for the made-up skater.

### Verified

`npm test`: 27 tests pass. The 11 new ones try a good reply and replies that break each rule (an invented skill id, a real skill that was not offered, a skill twice, 1 and 7 skills, 12 minutes, minutes as text, 65 minutes in all, a made-up number, a number from another skill's fact, a clock time, a long or two-line reason, no facts, five facts, an unknown fact, another skill's fact, a focus that is not the skater's words, a focus from another skill's notes, a made-up number in the summary, and several problems at once).

### Not verified, and a known limit

The number check makes sure each number in a reason appears in a fact the reason cites. It catches invented numbers, not every mix-up: "not practiced in 2 weeks" passes for the waltz jump because 2 is one of its last ratings. A test shows this, and README.md will say it.

## 2026-10-23 (Friday): talking to Claude Code

### Plan

Step 5, first half: the one file that talks to the model, Claude's instructions, the reply's shape, and a stand-in for Claude Code so the tests never call the model. Before writing it, the official Claude Code docs were checked for how headless mode reports its answer, how sign-in works, and how to keep a run clean.

### What the docs said (and changed)

- An API key always wins in headless mode, even over a subscription sign-in, and so does an `apiKeyHelper` in settings or `ANTHROPIC_AUTH_TOKEN`. So the coach does two things: it leaves every `ANTHROPIC_*` variable and the cloud-provider switches (`CLAUDE_CODE_USE_*`) out of the environment it gives Claude Code, and it asks `claude auth status` first and refuses to run unless the sign-in is a Claude subscription (`claude.ai`, or a `setup-token` token).
- With `--json-schema`, Claude Code checks the reply's shape itself and retries up to 5 times; the answer is in `structured_output`. If it gives up, that is the model's failure, so the coach treats it as an empty reply that its own checker refuses (and the one retry can fix).
- `--safe-mode` turns off CLAUDE.md, skills, hooks, plugins, MCP servers, and auto memory while keeping the sign-in. `--bare` would need an API key, so it is not used.
- The cost number Claude Code prints is an estimate at list price, not a charge, on a subscription.
- Not settled by the docs: whether `--tools ""` also takes away the tool Claude Code uses to return schema-checked JSON. The coach reads the answer either way (from `structured_output`, or from JSON in the text), and the live run will show which.

### Changes

- `prompts/coach.md`: Claude's instructions: what to decide, what makes a good plan, the reply's fields, digits only and numbers only from the cited facts, and never invent technique advice.
- `prompts/reply.schema.json`: the reply's shape only (fields and types). What the reply means is checked by `lib/check.js`.
- `lib/claude.js`: finds Claude Code (`CLAUDE_BIN`, the PATH, or the copy inside the Claude desktop app), cleans the environment, checks the sign-in, and runs `claude -p --output-format json --model sonnet --system-prompt <coach.md> --tools "" --safe-mode --strict-mcp-config --disable-slash-commands --no-session-persistence --json-schema <shape>` in an empty temporary folder, with the brief on stdin and a 3-minute limit. It hands back what came back, and sorts Claude Code's own failures (not signed in, a usage limit, too slow, could not start) from answers for the checker.
- `tests/fake-claude.mjs` and `tests/fixtures/outputs/`: a stand-in for Claude Code that answers `auth status` and prints recorded answers, and records what it was given (never the values of environment variables).

### Verified

`npm test`: 37 tests pass. The new ones check that API keys, cloud-provider switches, and session markers are left out of the environment; which Claude Code is found (newest desktop copy by version number, not by alphabet); the arguments (no tools, safe mode, no MCP servers, no saved session, the shape, never `--bare` or a permissions bypass); that only a subscription sign-in is accepted; how answers and failures are read; and, with the stand-in run as a real process, that the brief arrives on stdin, the run happens in an empty folder that is removed after, the API key never arrives, and a run that takes too long is stopped.

### Not verified

A real Claude Code run. Claude Code is not signed in on this Mac yet (the owner will run `npm run signin`).

## 2026-10-23 (Friday): one retry, MySkate's own plan, and the run log

### Plan

Step 5, second half: put the pieces together. Ask once; if the checks fail, ask once more with the list of problems; if that fails too, or Claude Code itself cannot answer, use MySkate's own suggestion and say why. Keep a log of every run.

### Changes

- `lib/pipeline.js`: `coach()` runs the brief, the question, the checks, and the one retry. A failed check goes back with the brief, the list of problems, and the last reply as it was. A failure of Claude Code itself (not signed in, a usage limit, too slow) is not retried, because asking again would not help. `runLog()` and `writeLog()` keep every attempt (the prompt, what Claude Code printed, the reply, its problems, the time taken, and Claude Code's own report of the model and tokens) and the result, in `runs/` (never committed).
- `lib/fallback.js`: MySkate's own plan: the skills MySkate's `suggestNext` picks (about 15 minutes each, 2 to 6 skills), the ice time shared out by MySkate's `splitMinutes`, topped up from the top of the brief's list when MySkate has too few to suggest.

### Verified

`npm test`: 45 tests pass. The new ones use a stand-in for Claude: a good plan the first time (asked once); a plan with 65 minutes that is fixed on the second try (the retry prompt has the brief, the problem, and the last reply); a plan that fails twice (MySkate's own plan, with the reason); an answer that is not JSON and an empty answer (retried like any failed check); a usage limit (not retried; MySkate's own plan says why). MySkate's own plan matches the app's own suggestion and its way of sharing minutes for 15, 30, 45, 60, and 120 minutes, and passes the same checks as Claude's plan. The run log keeps both attempts and their problems, and a second run in the same second gets its own file.

## 2026-10-23 (Friday): the command, tested end to end

### Plan

Step 6: the command the skater runs (`npm run coach`), the plan laid out for the terminal and as a file, and tests that run the whole command as a real process against the stand-in for Claude Code.

### Changes

- `coach.mjs`: finds MySkate and the newest backup (or the one given), asks for a locked backup's passphrase without showing it, says how fresh the backup is, checks the sign-in, runs the coach, shows each check as it happens, prints the plan, saves it to `plans/<day>.md`, and writes the run log to `runs/`. Options: `--slot`, `--today`, `--date`, `--model`, `--brief` (show what Claude would get, and stop), `--myskate` (MySkate's own suggestion, without Claude), and `--signin` (`npm run signin`: `claude auth login --claudeai`, the subscription sign-in, then a check that it worked). Exit codes tell the cases apart: 0 Claude's plan, 1 a problem with what was given, 2 Claude Code missing or not on a subscription, 3 Claude's plan could not be used so MySkate's own plan was shown, 4 a bug in MySkate Coach itself.
- `lib/format.js`: the plan for the terminal (color only in a terminal, wrapped to its width, a date like "Oct 7" kept on one line) and as Markdown (text from the model and the notes escaped, with a line saying where the plan came from and what was checked).

### Verified

`npm test`: 62 tests pass. The 17 new ones run the real command against the stand-in: a good plan (checked, shown, saved, logged); a plan fixed on the second try; a plan that fails twice (exit 3, MySkate's own plan, the reason); a usage limit (asked once, exit 3); an answer without a plan, Claude Code's own schema giving up, and a plan in a code fence; not signed in and signed in with an API key (Claude never asked, exit 2); an API key in the environment (left out, and the skater is told); Claude Code missing; `--brief` and `--myskate` (Claude never asked); the newest backup found in iCloud Drive's Downloads, and a clear message when there is none; a locked backup without a terminal; and eight bad options.

Also run by hand against the stand-in and read: the terminal output and the saved plan for the made-up skater.

### Not verified

A real Claude Code run, and the passphrase prompt in a real terminal (the tests can only check that it is not offered without one).

## 2026-10-23 (Friday): the README

### Plan

Step 7: write down exactly what Claude is responsible for and what the code checks, as the assignment asks, plus setup, use, cost, what is sent to Claude, how to tell whether a bad plan was Claude's or the code's, and the known limits.

### Changes

- `README.md`: what a run looks like (from the stand-in for now, to be replaced by a real run), how it works in six steps with who does each, a table of what Claude decides and what the code checks for each part of the plan, what is and is never sent to Claude, the cost (subscription only, no API key, what the cost estimate means), setup, use, exit codes and run logs for telling Claude's mistakes from the code's, the known limits, the tests, and the files.

### Verified

Read against the code: the checks, limits (90 and 140 characters, 2 to 6 skills, steps of 5, 60 skills offered, 60 days, 3 minutes), exit codes, options, and what the brief sends all match `lib/check.js`, `lib/brief.js`, `lib/claude.js`, and `coach.mjs`.

### Not verified

That an iPhone saves the backup to iCloud Drive's Downloads: that is Safari's default, but it can be changed, so the README says to give the file's path otherwise.

## 2026-10-23 (Friday): the workspace only

### Plan

The owner lets Claude work only inside `~/Documents/claude-workspace` and does not want it anywhere else. The coach looked for backups in Downloads and iCloud Drive and used the system's temporary folder, and so did the tests. Change all of it to stay inside the workspace.

### Changes

- `lib/paths.js`: the coach's folders (`backups/`, `plans/`, `runs/`, and `.run/` for Claude Code's empty working folders), the workspace (the folder that holds MySkate Coach), and `isInside`, which follows links so a link inside the workspace cannot lead out of it.
- The coach looks for backups only in its own `backups/` folder (with a README saying to put the backup there), refuses a backup path outside the workspace, refuses a `MYSKATE_DIR` or `COACH_OUT` outside it, and runs Claude Code in an empty folder inside `.run/`, removed after. It also tells Claude Code not to load CLAUDE.md files or memory (safe mode already does), since that folder now sits inside the repository.
- The tests make their scratch folders in `.tmp/` inside the repository, cleared before every `npm test`.
- `README.md` has a new section, "What the coach touches on your Mac", and the setup and use steps say to move the backup into `backups/`. `CLAUDE.md` has the owner's boundary.

### Verified

`npm test`: 64 tests pass. New ones check that a backup outside the workspace is refused, that a backup left in the home folder's Downloads is never found, that `MYSKATE_DIR` and `COACH_OUT` outside the workspace are refused, that Claude Code's working folder is inside the workspace and removed after, and what "inside" means (paths that climb out with `..`, a sibling folder with a similar name, a link). `grep` finds no use of the system's temporary folder, Downloads, or iCloud Drive left in the code or the tests.

### Not changed

Claude Code itself still runs from where it is installed (the Claude desktop app's copy), and keeps its sign-in and settings where it always does (the macOS Keychain and `~/.claude`), as the desktop app already does. The README says so.

## 2026-10-23 (Friday): the first real run

### Plan

Step 8: sign Claude Code in on the Mac with the owner's Claude subscription, and run the coach for real with the made-up skater (not the owner's own data).

### What happened

- The owner signed in through `npm run signin` (`claude auth login --claudeai`), started in the app's terminal panel at their request and finished by them in the browser. The coach's own check then reported a `claude.ai` sign-in, from the terminal and from this session.
- `npm run coach -- tests/fixtures/backup.json`: Claude's first plan passed every check, exit code 0, in about 8 seconds. The plan put the coach's homework first but kept it short because that skill is already earned, started the mazurka (new homework), gave the program's step sequence 10 minutes, gave the waltz jump the most time toward its goal, and brought back the spin that had gone 16 days without practice. Every focus was copied from the skater's own words.
- The run log settles what the docs did not: with `--tools ""`, Claude Code still returned the schema-checked reply in `structured_output`. Claude used no tools (nothing was denied); Claude Code counted 2 turns, the second most likely its own step for returning the checked JSON. Model: Claude Sonnet 5.5. About 5,300 tokens in and 1,100 out (570 of them thinking). Claude Code's cost estimate was $0.03; on a subscription that is not a charge.

### Changes

- `README.md`: "What a run looks like" now shows this real run, and the cost section gives its size. The failed-check example is labelled as coming from the tests.

### Verified

The run itself, its run log (one attempt, no problems, `claude.ai` sign-in, `structured_output` present, no permission denials), the saved `plans/2026-10-24.md`, and that `git` ignores `plans/` and `runs/`. `npm test` still passes (64).

### Not verified

A real run that fails a check and retries (the tests cover it with the stand-in); a run with the owner's own backup; the passphrase prompt in a real terminal. Whether CLAUDE.md files reach the model is not observed directly: safe mode and `CLAUDE_CODE_DISABLE_CLAUDE_MDS` are both documented to keep them out.

## 2026-10-23 (Friday): on GitHub

### Plan

The owner created the empty public repository `iiSurf/MySkate-Coach` and asked to push it, then the Portfolio, and to check both live.

### Changes

- Pushed `main` (10 commits, 37 files: the code, tests, docs, prompts, and made-up test data) to https://github.com/iiSurf/MySkate-Coach. Backups, run logs, plans, and scratch folders stay on the Mac (`.gitignore`). The repository was checked to be empty first, and nothing was forced.
- The Portfolio's Artifact 3 card, which links here, was pushed after this, so the link never pointed at a missing page.

### Verified

`npm test` (64 pass) just before the push. The repository page on GitHub: public, every file there, and the README rendered with all its sections and the table of what Claude decides and what the code checks. The live Portfolio card opens this repository in a new tab.
