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
