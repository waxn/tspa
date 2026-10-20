# tspa

A keyboard-first memory tool that runs in the browser. Capture anything in two keystrokes, write notes with
Notion-style shortcuts, keep tasks and silent reminders, and watch your self-hosted services on a btop-style dashboard.

Backend: FastAPI + SQLite. Frontend: plain JavaScript modules, no build step, no external fonts or scripts (so it
loads on a locked-down school network). Dark by default; light theme in the `/` palette.

## The idea: low friction

Everything starts with **Space**. Press it anywhere, type, press Enter. Plain thoughts land in the **inbox**; anything
with a clear signal becomes the right thing immediately. You sort the inbox later, with one key per thought.

| type | becomes |
|---|---|
| `call mom in 30m` / `dentist tomorrow 8am` | silent reminder |
| `bio lab due fri 5pm #bio !!` | assignment, project `bio`, high priority |
| `buy milk tomorrow` | todo due tomorrow |
| `n: idea for a flight tracker` | note |
| `p: Cessna build` | project |
| `my flight tracker could use ADS-B feeds…` (anything else) | a **thought** in the inbox |

The capture bar shows what it will do before you press Enter. `Tab` forces a type. Closing it keeps your text, so
nothing is lost. `u` undoes the last thing you did (capture, delete, done, sort). Dates are US month/day in `TZ`.

## Keys

| | |
|---|---|
| `Space` | capture |
| `/` | search and jump: notes, **headings inside notes**, tasks, thoughts, commands (`#` headings only, `>` commands) |
| `1`–`5` | home · notes · tasks · inbox · services |
| `↑↓←→` or `hjkl` | move (between panels on home) · `Enter` open · `x` done · `e` edit · `d` delete · `n` new |
| `Esc` | close / leave a text box / go home |
| `?` | full key list |

The mouse and touch work everywhere too (every row, button and tab is clickable; phones get a `+` button).
Dates in forms accept plain words: `fri 5pm`, `in 2 hours`, `10/24`.

## Notes

A block editor that saves plain Markdown. `#` `##` `###` headings, `-` bullets, `1.` numbers, `[]` to-dos, `>` quotes,
` ``` ` code, `---` divider, `/` for a block menu, `Tab` to indent, `Alt+↑↓` to move a block, `Ctrl+B/I/E` for
bold/italic/code, `Ctrl+Z` undo. The block you are in shows raw Markdown; the rest render. Headings fill the outline
on the right and are searchable from anywhere with `/` then `#`. Notes autosave; `Esc` returns to the note list.

## Services dashboard

Press `5`, then `n`. Two kinds of tile:

- **up / down**: HTTP check with response time and a history strip. A red `N down` badge appears in the header.
- **numbers from a JSON API**: pick values by path (`photos`, `usage.bytes`) and format them (`num`, `bytes`, `pct`, `dur`).
  The form has a "test" button that fetches your URL and lists every value it finds, so you click instead of guessing.
  There is an Immich preset (`/api/server/statistics` with an `x-api-key` header).

The **server** makes the requests every 30 s, so API keys never reach the browser, but tspa must be able to reach your
services. Run it on the same network (or use the service's LAN address). `localhost` inside Docker means the container.
Headers (API keys) are stored as plain text in the database.

## AI (optional)

With an AI configured, each captured thought is summarised in the background (a short headline, tags) and, when it clearly
is a task, reminder or note, gets a suggestion chip. `Enter` in the inbox accepts it. Nothing is ever changed without you.
Works with any OpenAI-compatible endpoint: OpenRouter (use a `:free` model), or Ollama / LM Studio on your own machine, in
which case no text leaves it. Set `AI_API_KEY` and `AI_MODEL` (and `AI_BASE_URL` for self-hosted). Only the thought's text and your
project names are sent. Capped at `AI_DAILY_LIMIT` calls per day (default 40). The app works fully without it.

## Phone

It is a PWA today: open it on Android, "Add to Home screen". Reminders arrive as silent notifications (Web Push, see below).
Installed, it appears in the Android share sheet ("share to tspa" opens the capture bar with the text) and has a "Capture"
shortcut on long-press.

For automation or a future native app there is a token API: set `API_TOKEN` (24+ characters) and
`curl -H "Authorization: Bearer $API_TOKEN" -H 'content-type: application/json' -d '{"text":"call mom in 2h"}' https://your-host/api/capture`.
The same token works on every `/api/*` endpoint, so an Android app can be built against the API as it is.

### Silent notifications

Click the bell in the header. While a tab is open, reminders pop up instantly (server-sent events). For popups when the tab
is **closed**, generate Web Push keys (`uv run python -m app.gen_vapid`), put them in `.env`, and click the bell again on
each device. Needs `localhost` or HTTPS. Notifications are sent with `silent: true`; your OS settings can still override that.

## Run (dev)

```bash
uv sync
cp .env.example .env
uv run python -m app.set_password        # paste the PASSWORD_HASH='...' line into .env
# also set SECRET_KEY in .env to a long random string:  python -c "import secrets; print(secrets.token_hex(32))"
uv run uvicorn app.main:app --reload     # http://localhost:8000
```

Run **one** worker only (the reminder and service pollers live in the process). Existing databases are upgraded
automatically on startup (new columns are added; nothing is dropped).

## Docker

```bash
git clone https://github.com/waxn/tspa.git && cd tspa
docker compose build
docker compose run --rm tspa python -m app.set_password --file /data/password_hash   # choose your password
docker compose up -d                                                                  # http://localhost:8000
```

- Your data (database, password hash, auto-generated secret key) lives in the `tspa-data` Docker volume and survives
  rebuilds and `docker compose down`. **`docker compose down -v` deletes it.**
- Optional settings (`TZ`, `AI_*`, `API_TOKEN`, `VAPID_*`) go in a `.env` file next to `docker-compose.yml`; see `.env.example`.
- Update: `git pull && docker compose up -d --build`.
- Backup: `docker run --rm -v tspa_tspa-data:/data -v "$PWD":/out alpine tar czf /out/tspa-backup.tgz -C /data .`
- If the build fails with `Failed to resolve pypi.org`, Docker's DNS is broken on your machine. The compose file already builds with the host's network and sets DNS for the running container; to fix it properly, put `{ "dns": ["1.1.1.1", "8.8.8.8"] }` in `/etc/docker/daemon.json` and restart Docker.
- By default it only listens on `127.0.0.1`. That's what you want on your own machine.

### Using it from your school computer

The browser on that machine has to reach tspa, so it must be online somewhere. You can't install VPN software on a school
computer, so Tailscale (which needs a client on each device) will not work there. Realistic options:

1. **Cloudflare Tunnel** (free, no open ports, HTTPS included) or a **VPS + Caddy** (needs a domain). Set `HTTPS_ONLY=true`.
2. Either way, `TSPA_BIND=0.0.0.0` is only needed if something other than the same machine connects directly.

Don't expose it over plain HTTP: your password would cross the network in the clear. There is a login throttle (5 wrong
tries per 5 minutes per address), but use a long password. School networks sometimes block unfamiliar domains; test the URL
at school before relying on it.

## Tests

```bash
uv run pytest        # API + parser + a real-browser suite that drives the keyboard (skips if Chromium is missing)
```

## Known limits

- One user, one password. Two devices editing the **same note** at the same moment: the last save wins (an idle device
  picks up the other's changes automatically).
- All notes are loaded into the browser at startup. Fine for thousands of short notes; not designed for a huge archive.
- Service history is kept in memory and resets when the server restarts.
- No schema migrations beyond adding columns. Back up the volume before big upgrades.
- Android: it is a PWA, not a native app yet.
