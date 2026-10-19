# tspa

A btop/glances-style productivity app that runs in the browser: todos, assignments with due dates,
projects, notes, a stream-of-consciousness log, and silent popup reminders. Keyboard-first, fully clickable.
Backend: FastAPI + SQLite. Frontend: plain JS, no build step.

## Run (dev)

```bash
uv sync
cp .env.example .env
uv run python -m app.set_password        # paste the PASSWORD_HASH='...' line into .env
# also set SECRET_KEY in .env to a long random string:  python -c "import secrets; print(secrets.token_hex(32))"
uv run uvicorn app.main:app --reload     # http://localhost:8000
```

Run **one** worker only (the reminder scheduler lives in the process).

## Quick add (`a` or `Space`)

| type | becomes |
|---|---|
| `Bio project due 10/24` | assignment due Oct 24 (end of day) |
| `english paper due friday 5pm #eng !!` | assignment, project `eng`, priority 2 |
| `va state test 2hr` | silent reminder in 2 hours (`30m`, `1h30m`, `in 2 hours`) |
| `call mom at 3pm` / `dentist tomorrow 8am` | reminder at that time |
| `buy milk tomorrow` | todo due tomorrow |
| `n: idea…` / `i: thought` / `> thought` | note / stream entry / stream entry |
| `p: Cessna build` | new project |

`Tab` in the bar forces a type. The preview shows exactly what will be created before you press Enter.
Dates are read as US month/day in `TZ` (default `America/New_York`). First word matching an existing project name attaches it.

## Keys

`a` add · `1–6` panels · `Tab` next · `j/k` move · `Enter/e` edit · `x` done/pin/dismiss · `n` new · `d` delete ·
`/` filter · `h` show done · `z` zoom · `i` stream · `?` help. Everything on screen is also clickable (double-click edits).

## Notifications (silent)

- Click `notify: off` in the header. While a tab is open, reminders pop up instantly (server-sent events).
- For popups when the tab is **closed**, generate Web Push keys and put them in `.env`:
  `uv run python -m app.gen_vapid`, then re-click the notify button on each device.
- Needs `localhost` or HTTPS. iPhone: add the site to the Home Screen first. Notifications are sent with `silent: true`,
  but your OS settings can still override that.

## AI fallback (optional)

Set `OPENROUTER_API_KEY` and `OPENROUTER_MODEL` (a `:free` model id). Only used when the rule parser is unsure and you press Enter —
the preview then shows `[ai]` and you press Enter again to accept. Capped at 40 calls/day (free accounts get ~50). The text you
type in that case is sent to OpenRouter.

## Tests

```bash
uv run pytest                 # unit + API + real-browser tests (the browser test skips if Chromium is missing)
```

## Docker (nothing to install but Docker)

```bash
git clone https://github.com/waxn/tspa.git && cd tspa
git checkout claude/great-cerf-ybhcgd
docker compose build
docker compose run --rm tspa python -m app.set_password --file /data/password_hash   # choose your password
docker compose up -d                                                                  # http://localhost:8000
```

- Your data (database, password hash, auto-generated secret key) lives in the `tspa-data` Docker volume and survives
  rebuilds and `docker compose down`. **`docker compose down -v` deletes it.**
- Optional settings (`TZ`, `OPENROUTER_*`, `VAPID_*`) go in a `.env` file next to `docker-compose.yml`; see `.env.example`.
- Update: `git pull && docker compose up -d --build`.
- Backup: `docker run --rm -v tspa_tspa-data:/data -v "$PWD":/out alpine tar czf /out/tspa-backup.tgz -C /data .`
- By default it only listens on `127.0.0.1`. That's what you want on your own machine.

### Putting it online (both houses)

Not set up yet; the options, easiest first:
1. **Tailscale** on the host + your devices: private, free, no domain. Run compose on a machine that's always on, set
   `TSPA_BIND=0.0.0.0`, and open `http://<tailscale-name>:8000`. Notifications need HTTPS though; `tailscale serve` gives you that.
2. **Cheap VPS + Caddy** (automatic HTTPS, needs a domain). Set `HTTPS_ONLY=true` in `.env` so the login cookie is HTTPS-only.

Don't expose it to the internet over plain HTTP: your password would cross the network in the clear.

## Not done yet

Database migrations (tables are created on startup; add Alembic before storing data you can't lose) and a one-command HTTPS setup.
