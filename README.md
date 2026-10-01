# Rota

A web page that shows one word: the name of the parent who has the children right now. It updates itself every 30 seconds and is correct across the clock changes.

There is no database, no server code and no sign-in. The page works the answer out in the browser from `rota.json`.

**Keep it that way.** The page is public, so it must never show anything that identifies the children, their school or a phone number. With only a parent's first name on it, a stranger who finds the address learns nothing useful.

## How the rota works

- The pattern repeats every 14 nights, counted from the **anchor date**. The first letter in `nights` is the anchor date's night. It carries on unchanged through school holidays.
- On school days (Monday to Friday, unless listed in `closures`), the parent who has that night takes over at **school start** (`schoolStart`, 08:45).
- On weekends and anything listed in `closures`, they take over at `nonSchoolHandover` (17:00).
- **Overrides** (swaps, holidays, cover) replace the pattern for the times given. If two overlap, the one lower down the file wins.

## Making a change: editing rota.json

You do this on the GitHub website, and there's nothing to install.

1. Open the repo on GitHub, click `rota.json`, then the pencil icon.
2. Make the change.
3. Click **Commit changes**.
4. Cloudflare rebuilds the page in about a minute. If there's a typing mistake, the build stops and the **old version stays live**. The project's **Deployments** page in Cloudflare shows what went wrong.

**A swap or holiday.** Add an entry to `overrides`. Times are UK time, written as `YYYY-MM-DD HH:MM`.

```json
"overrides": [
  { "from": "2026-10-22 15:30", "to": "2026-10-27 17:00", "parent": "B", "note": "Half-term holiday" }
]
```

**A change of pattern from a future date.** Add a second pattern. Dates before its `from` date are unaffected.

```json
"patterns": [
  { "id": "2-2-3", "from": "2026-09-28", "anchor": "2026-09-28", "nights": "BBAABBB AABBAAA" },
  { "id": "2-2-5-5", "from": "2027-01-04", "anchor": "2027-01-04", "nights": "AABBAAA AABBBBB" }
]
```

Spaces in `nights` are ignored, so you can split it into weeks to make it easier to read.

## One-time setup on Cloudflare

1. Sign up at **dash.cloudflare.com**.
2. Go to **Workers & Pages**, then **Create**, then the **Pages** tab, then **Connect to Git** (it may say **Import an existing Git repository**). Choose GitHub and allow access to this repo only.
3. **Project name:** choose something that doesn't include the children's names, e.g. `fe-rota-7k2`. It becomes the address, e.g. `https://fe-rota-7k2.pages.dev`.
4. Build settings:
   - Production branch: `main`
   - Framework preset: `None`
   - Build command: `npm run build`
   - Build output directory: `dist`
5. Click **Save and Deploy**. After about a minute, open the address and you should see a name.

To take the page down, delete the project in Cloudflare.

## Backing up

Everything is in this repo, and GitHub keeps the full history of every change to `rota.json`, including who made it and when. For an extra copy, use **Code**, then **Download ZIP**, now and then.

## For whoever maintains the code

This needs Node.js 22.18 or later, and nothing to install.

```sh
npm test         # rota engine, file loading and build tests
npm run build    # build into dist/
npm run preview  # then open http://localhost:8788
```

| Path | What it is |
|---|---|
| `src/rota/engine.ts` | Works out who has the children at any moment |
| `src/rota/time.ts` | UK time and clock-change handling |
| `src/rota/load.ts` | Reads `rota.json`, with plain-English errors |
| `src/app/` | The page, plus security headers that stop search engines indexing it |
| `scripts/build.ts` | Builds `dist/` for Cloudflare |
