# Frontend Live Validation

- Default design/test stack: an idle interactive Pi worker, its real scoped CLI
  backend and databases, and a backend-connected hot frontend preview.
- Keep the agent/database session running while editing frontend code; restart
  only the frontend preview when needed. Opening a page or saving code must not
  start extraction or send an automatic continuation prompt.
- A plain Vite page, static fixture or replay is not proof of live ghosts,
  processor activity or chat. Synthetic unit tests remain useful separately.
- Run paid processing only for the user's requested test; never auto-approve
  facts or edit a live writer's database to manufacture visible progress.
- Keep API keys and operator capabilities out of source, handoff documents,
  reports and screenshots. Expose a phone tunnel only when explicitly requested,
  through the protected host with exact origin checks and a bounded lifetime.
- See `../../tools/pi-review/README.md` for the portable Pi/host contract. Local
  service paths and private link helpers belong in the user's private handoff,
  not committed runtime configuration.
