# Muse-host loopback relays

When Muse hosts a novel-ontology-pi run, the CLI's model calls go through
these two loopback relays instead of reaching providers directly:

- `jev-relay.py` — decision model (Jev). The CLI posts the System One wire
  shape; the relay shells out to a host-provided helper that holds the real
  TypeSafe credential.
- `work-relay.py` — work/generation model. The CLI posts OpenAI-shaped
  `/v1/chat/completions`; the relay shells out to a host-provided helper
  that holds the real work-model credential.
- `start.mjs` — supervisor: starts both, restarts a relay that exits
  unexpectedly (500 ms backoff, gives up after 5 rapid failures), writes
  child PIDs to a pidfile, and stops both children on SIGINT/SIGTERM.

## Why relays instead of copied keys

Key values never move. The host's credential store (in Muse's case, the
vault behind its connector CLIs) never reveals a value, and the CLI's own
secret store (`~/.config/novel-ontology/secrets.json`) never prints one
either. The relays strip authorization at the loopback boundary: the CLI
authenticates to the relay with a placeholder, the relay authenticates to
the provider through the helper, and nothing secret ever enters the CLI's
environment or its store. The non-Muse path is unchanged: a user provisions
the CLI's own store once with `novel jev login` and the CLI calls
providers directly.

## Hosting a run (Muse)

```sh
MUSE_JEV_HELPER=/path/to/jev-helper \
MUSE_WORK_HELPER=/path/to/work-helper \
node tools/muse-relay/start.mjs
```

Then run the CLI with its endpoints pointed at the relays:

```sh
JEV_ENDPOINT=http://127.0.0.1:8791 \
WORK_LLM_BASE_URL=http://127.0.0.1:8792 \
TYPESAFE_API_KEY=relay WORK_LLM_API_KEY=relay \
novel ingest ...
```

The placeholder key values are never transmitted beyond loopback: the
relays ignore the CLI's authorization headers entirely. `JEV_ENDPOINT` is
an existing CLI option (default `https://api.typesafe.ai/v1/systemone`);
no Jev wire-format, threshold, or decision change is involved.

## Security notes

- Both relays bind `127.0.0.1` by default (`MUSE_RELAY_HOST`). A
  non-loopback bind prints a warning and is not a supported
  configuration: it would expose vault-backed helpers to the network.
- Helpers run as the operator, with the operator's privileges. Only
  helpers the operator trusts may be configured.
- Requires `python3` (standard library only, no dependencies).

## Stopping

Send SIGINT/SIGTERM to the supervisor (Ctrl-C); it stops both relays and
removes the pidfile. A SIGKILLed supervisor leaves a stale pidfile behind;
the relays themselves keep serving until stopped by PID.
