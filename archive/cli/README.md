# v1's commands (archived 2026-11-11)

`cli.ts` is the `novel` command as it stood before v1's commands were taken out. `commands/` holds the command
modules nothing else used, and `test/` the tests of the archived commands. The command modules that live code still
imports (album, portraits, review, stage, timeplace, checklist, fix) stay in `src/cli/commands/`. Not maintained, not
built; see docs/v3/design.html#skills for what replaced each.
