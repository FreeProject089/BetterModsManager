# BMM Telemetry Dashboard

Privacy-first, opt-in telemetry for Better Mods Manager.

**Stack (v2 — scalable):**

- **Backend** — Rust + [Axum](https://github.com/tokio-rs/axum) + **PostgreSQL** (`sqlx`). All
  stats are derived from a single `events` table, so retention and per-packet
  erasure are exact. Live updates are pushed to the dashboard over **SSE**.
- **Frontend** — React + TypeScript + Tailwind + ECharts (`web/`), multi-page.
- **Docker** — `docker compose up` brings up Postgres + API + dashboard.

Data lives in Postgres (the `pgdata` volume), so **restarting the server keeps
every past event** — nothing is lost.

```
telemetry-dashboard/
  server/   Rust/Axum API + Postgres layer + stats derivation
  web/      React/Tailwind dashboard (built to web/dist, served by the API)
  Dockerfile, docker-compose.yml
  *.mjs     legacy Express/SQLite version (deprecated, kept for reference)
```

## Run with Docker (recommended)

```bash
cd telemetry-dashboard
# optionally set keys:  export API_KEY=...  ADMIN_KEY=...
docker compose up --build
# dashboard + API on http://localhost:8900
```

## Run locally (dev)

```bash
# 1) Postgres
docker run -d --name bmm-pg -e POSTGRES_USER=bmm -e POSTGRES_PASSWORD=bmm \
  -e POSTGRES_DB=telemetry -p 5432:5432 postgres:16-alpine

# 2) API (reads server/.env — copy from .env.example)
cd server && cargo run
#   → http://localhost:8900

# 3) Dashboard with hot reload (proxies /api + /batch to :8900)
cd web && npm install && npm run dev
#   → http://localhost:5180
```

## Configuration (`server/.env`)

| Var             | Default                                        | Meaning                                   |
| --------------- | ---------------------------------------------- | ----------------------------------------- |
| `PORT`          | `8900`                                         | HTTP port                                 |
| `API_KEY`       | _(empty)_                                      | key the BMM client sends in every batch   |
| `ADMIN_KEY`     | _(empty)_                                      | unlocks deletion approvals + goal writes  |
| `RETENTION_DAYS`| `180`                                          | rows older than this are auto-purged      |
| `DELETE_DELAY_H`| `72`                                           | mandatory review delay before auto-erase  |
| `DATABASE_URL`  | `postgres://bmm:bmm@localhost:5432/telemetry`  | Postgres DSN                              |
| `STATIC_DIR`    | `public`                                       | built dashboard to serve at `/`           |

## Endpoints

| Method | Path                     | Purpose                                            |
| ------ | ------------------------ | -------------------------------------------------- |
| POST   | `/batch`                 | ingest a PostHog-style batch (tagged by packet id) |
| POST   | `/delete-request`        | user-initiated erasure (applied after review delay)|
| GET    | `/api/stats`             | full payload snapshot                              |
| GET    | `/api/stream`            | **SSE** live push of the payload                   |
| GET    | `/api/sessions`          | recent sessions                                    |
| POST   | `/api/funnel`            | funnel over ordered view steps (`*` wildcard)      |
| GET/POST/DELETE | `/api/goals`    | goals (writes need `X-Admin-Key`)                  |
| GET    | `/api/event?name=`       | recent occurrences of one event (who/when/props)   |
| GET    | `/api/user?id=`          | one user's session-by-session journey              |
| GET    | `/api/packet-status?ids=`| deletion status per packet (BMM polls this)        |
| GET    | `/api/admin/deletions`   | review queue (`X-Admin-Key`)                       |
| POST   | `/api/admin/decide`      | approve / reject a deletion now (`X-Admin-Key`)     |

## Privacy

- **Opt-in only** — nothing is collected without consent.
- **Approximate geo only** — IP → country/region, rounded + jittered; precise
  location is never stored or shown.
- **Right to erasure** — each packet has an id; a delete request erases exactly
  those rows after the review delay, or immediately on admin approval.
- **Retention** — data older than `RETENTION_DAYS` is purged automatically.
