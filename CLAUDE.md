# MySkate Coach

A practice coach for MySkate (https://github.com/iiSurf/MySkate). It reads a MySkate backup, asks Claude (through Claude Code, headless) to plan the next session, checks the plan with plain code, and prints it. The owner (GitHub: iiSurf) is a figure skater at Learn to Skate USA Pre-Free Skate and its first user.

This is Artifact 3 ("AI Inside It") for TCSS 490. The Portfolio card is the Artifact 3 entry in `cards.js` in github.com/iiSurf/Portfolio.

## The one rule: the model's part stays small and checkable

- The model gets a brief (numbered facts from the backup and a list of skills it may pick) and answers with one JSON reply. It has no tools. The exact split of who does what is in README.md under "What Claude does and what the code checks". Keep that section true.
- `lib/claude.js` is the only code that talks to the model. `lib/check.js` holds every check on the reply, and every check has a test.
- Changing what the model is asked to do means changing these together: `prompts/coach.md`, `prompts/reply.schema.json`, `lib/check.js`, its tests, and the README section.
- The checker never trusts the reply. A failed check retries once with the list of problems, then falls back to MySkate's own suggestion, and says so.
- Every run writes a log to `runs/` (prompt, raw replies, problems, result), so a bad plan can be traced to the model or to the code.

## Stack and constraints

- Node 22, ES modules, no dependencies. `npm test` runs Node's built-in test runner. Tests never call the model: `tests/fake-claude.mjs` stands in for it with recorded replies.
- MySkate's own code is reused from the MySkate folder next to this one (`../MySkate`), or from `MYSKATE_DIR`. Never copy MySkate code into this repository, and never write into the MySkate folder.
- No API key, ever. Claude Code runs on the owner's Claude Code sign-in. `lib/claude.js` leaves `ANTHROPIC_API_KEY` and the other `ANTHROPIC_*` variables out of the environment it gives Claude Code. Do not use `--bare`: it only works with an API key.
- Send the model only what the plan needs. Never send the skater's name, friends, costs, or rinks.

## Working agreements

- Plan before building anything large. Small changes, a commit after each working step with a clear message.
- A dated entry in `LOG.md` after each meaningful change: what was planned, what changed, what was verified, and what was not.
- Never commit a real backup, a run log, or a saved plan. `runs/` and `plans/` are ignored because they hold the skater's data. Test data is made up.
- Plain language in everything the skater reads.
