# FIFA World Cup 2026 — Bracket Challenge ⚽🏆

A single-page web app where friends predict the **entire FIFA World Cup 2026** — group standings, the full knockout bracket, the champion, and every group-stage match result — then get scored against the real outcomes on a shared leaderboard.

> **Live site:** https://asim1234lab.github.io/worldcup--2026/ *(once GitHub Pages is enabled)*

## How it works

1. **Log in** with your name + phone number.
2. **Build your bracket** (8-step wizard):
   - Order all 12 groups 1st → 4th
   - Pick the 8 best third-place teams (48-team format)
   - Tap winners through R32 → R16 → QF → SF → Third place & Final
   - The bracket auto-builds from your group picks using the official match structure.
3. **Submit** — your bracket locks permanently.
4. **Predict group matches** — once your bracket is locked, call Home / Draw / Away for all 72 group games. Each opens 72h before kickoff and locks 15 min before.

## Scoring

| Stage | Points |
|-------|-------:|
| Group match (correct result) | 2 |
| Round of 32 | 1 |
| Round of 16 | 2 |
| Quarter-final | 4 |
| Semi-final | 6 |
| Third place | 4 |
| Final | 10 |

## Files

| File | Purpose |
|------|---------|
| [`index.html`](index.html) | The full app — HTML + CSS + vanilla JS, no build step |
| [`worldcup2026-fifa.html`](worldcup2026-fifa.html) | Identical copy of `index.html` |
| [`wc2026-backend.gs`](wc2026-backend.gs) | Google Apps Script backend (Google Sheet as database + JSON API) |

## Backend setup

The backend is a Google Apps Script web app backed by a Google Sheet. Setup steps are documented at the bottom of [`wc2026-backend.gs`](wc2026-backend.gs). In short:

1. Create a Google Sheet → **Extensions → Apps Script**, paste `wc2026-backend.gs`.
2. Run `initSheet` once to create the `users` and `results` tabs.
3. **Deploy → Web app** (execute as *Me*, access *Anyone*), copy the `/exec` URL.
4. Paste that URL into `index.html` at `const API = { URL: '…' }`.
5. Enter real match results in the `results` tab as games finish — scores recalculate automatically.

If no API URL is configured, the app runs offline using `localStorage` only.
