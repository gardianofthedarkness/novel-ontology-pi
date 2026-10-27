# Errors that agents can act on

The `novel` CLI is mostly driven by agents. When a command fails, the agent
needs to know four things: what kind of problem it is, where it is, why it
happened, and what to run instead. Without them it retries variants blindly.
The design follows rustc's diagnostics: a stable code, a precise span, notes
about what was observed, and suggestions graded by how safe they are.

## The report

Every failure prints one JSON object on stderr and exits with its aspect's code:

```json
{
  "error": "Binder exception: Cannot find property canonicalName for c.",
  "aspect": "query", "code": "QUERY_UNKNOWN_PROPERTY",
  "span": { "argument": 2, "text": "c.canonicalName", "offset": 33, "length": 15 },
  "notes": ["c is bound to Character in the MATCH pattern; Character has: id, canonical_name, importance."],
  "suggestions": [{ "message": "Use c.canonical_name", "applicability": "machine-applicable",
                    "command": ["query", "<dir>", "MATCH (c:Character) RETURN c.id, c.canonical_name"] }],
  "hint": "…", "next": ["…"], "explain": "novel explain QUERY_UNKNOWN_PROPERTY"
}
```

| Aspect | Exit | Meaning |
|---|---|---|
| usage | 2 | arguments or options |
| path, not_found | 3 | a directory, file or id that is not there |
| query, graph | 4 | Cypher the graph cannot run; a missing or outdated graph |
| review, stale, evidence, conflict, source | 5 | the gate, a changed packet, unread evidence, a clash with canon, a changed source |
| model, budget | 6 | credentials, model calls, run limits |
| internal | 1 | unexpected (a bug) |

- **span** says which argument is wrong (0 is the verb), which decision in a batch, or which text inside a query.
- **notes** are evidence: what the CLI actually checked. Examples: the table the query's MATCH binds a variable to, the packet's real fact ids, an `entity.merged` event that removed an id, workspaces next to a wrong path.
- **suggestions** carry an `applicability`:
  - `machine-applicable`: run the command as given.
  - `maybe-incorrect`: check it against the notes first.
  - `has-placeholders`: fill in the `<…>` parts.

  A suggestion that changes a review decision is never machine-applicable: the fact must be re-read.

## Adding an error

1. Give it a code in `src/ground/errorCatalog.ts`, with a title, why it happens and how to fix it. `novel explain <code>` prints that entry, and codes are stable.
2. Throw `NovelError(message, { aspect, code, details })` where the aspect is known. Otherwise `describeError` (`src/ground/errors.ts`) classifies the message by pattern and by the command that failed.
3. When the state can say more, add a gatherer to `src/cli/diagnose.ts`. It reads only, finishes within 2 s, and puts its findings in `notes`, `span` and `suggestions`. Diagnosis must never change anything or hide the original error.
4. Add a test in `test/cli-diagnose.test.ts` that runs the real failure and checks the fix it suggests.
