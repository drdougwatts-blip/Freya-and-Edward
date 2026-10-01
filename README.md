# Who to contact

A small private web page that shows the school, and anyone else you allow, which parent has the children at any moment, with tap-to-call numbers for both parents.

There is no database and no server code. The page works everything out in the browser from:

- **`rota.json`** (in this repo): the repeating pattern, school closures, and any holidays or swaps. It contains no names, only "A" and "B".
- **The people data** (never in this repo): the children's first names, the school name, and each parent's name, phone and email. This is stored as a setting in Cloudflare.

Cloudflare Access sits in front of the whole site. Nobody can see anything without signing in with an email address you have approved. They get a one-time code by email, so no passwords are needed.

## What the page shows

1. **Now:** who has the children, their phone and email, until when, and who is next. The other parent is always shown underneath as "If no answer, contact".
2. **Look up:** the same for any date and time.
3. **Month:** a colour-coded calendar with handover times. The Print button gives a single A4 page.

All times are UK time and are correct across the clock changes.

## How the rota works

- The pattern repeats every 14 nights (or any length), counted from an **anchor date**. The first letter in `nights` is the anchor date's night.
- On a **school day**, the parent who has that night takes over at **school start** and collects the children after school.
- On a **non-school day** (weekends, and anything listed in `closures`), the parent who has that night takes over at the pattern's `nonSchoolHandover` time. This is 17:00 unless you change it.
- **Overrides** (holidays, swaps, cover) replace the pattern for the times given. If two overlap, the one lower down the file wins.

## Everyday changes: editing rota.json

You do all of this on the GitHub website, and there's nothing to install.

1. Open the repo on GitHub and click `rota.json`, then the pencil icon.
2. Make the change (see the examples below).
3. Click **Commit changes**.
4. Cloudflare rebuilds the site in about a minute. If you have made a typing mistake, the build stops and the **old version stays live**. Check the project's **Deployments** page in Cloudflare to see whether it worked. A failed build shows the reason in its log.

**Add a holiday or swap.** Add an entry to `overrides`. Times are UK time, written as `YYYY-MM-DD HH:MM`.

```json
"overrides": [
  { "from": "2026-10-22 15:30", "to": "2026-10-27 17:00", "parent": "B", "note": "Half-term holiday" }
]
```

Remember that the school sees the note. Keep it short and neutral.

**Add school holidays, INSET days and bank holidays.** Add them to `closures` (both dates inclusive). Do this for each new school year. Without it, the page assumes a school-day handover at school start on those days.

```json
"closures": [
  { "from": "2026-10-26", "to": "2026-10-30", "label": "Half term" },
  { "from": "2027-05-03", "to": "2027-05-03", "label": "Bank holiday" }
]
```

**Change to a different pattern from a future date.** Add a second pattern. Dates before its `from` date are unaffected.

```json
"patterns": [
  { "id": "2-2-3", "from": "2026-01-05", "anchor": "2026-01-05", "nights": "AABBAAA BBAABBB" },
  { "id": "2-2-5-5", "from": "2027-01-04", "anchor": "2027-01-04", "nights": "AABBAAA AABBBBB", "nonSchoolHandover": "18:00" }
]
```

Spaces in `nights` are ignored, so you can split it into weeks to make it easier to read.

## One-time setup

You need a GitHub account (you have one), a free Cloudflare account and, ideally, a domain name you control (about £10 a year). A domain is needed if you want the sign-in on a tidy address such as `rota.yourname.uk`.

### 1. Keep this repo private

On GitHub, go to **Settings**, then **General**, then **Danger zone**, and check that the visibility is **Private**.

### 2. Put in your real rota

Edit `rota.json` with your real anchor date, the 14 nights, the school start time and this year's term dates. The file in the repo contains placeholders.

### 3. Create the site on Cloudflare

1. In Cloudflare, go to **Workers & Pages**, then **Create**, then **Pages**, then **Connect to Git**, and choose this repo.
2. Use these build settings:
   - Production branch: `main`
   - Build command: `npm run build`
   - Build output directory: `dist`
3. Under **Environment variables (Production)**, add:
   - `ROTA_PEOPLE`: the people data as a single JSON value, in the same format as `people.example.json`, with your real details. Tick **Encrypt**. A parent's `phone` and `email` are optional. Leave them out and the page says "Use the number on school records" instead.
4. Deploy. Leave `ROTA_PEOPLE` out of the **Preview** environment on purpose. Test branches will then fail to build and never publish real details.
5. Optionally add your domain under the project's **Custom domains**.

Keep a copy of the `ROTA_PEOPLE` value in your password manager. Cloudflare won't show it again once it's encrypted.

### 4. Lock it down with Cloudflare Access (essential)

**Until you finish this step, the site is public.** Do it straight after the first deploy.

1. In Cloudflare, open **Zero Trust**. The free plan covers up to 50 people. If you are asked, choose a team name.
2. Go to **Settings**, then **Authentication**, and make sure **One-time PIN** is enabled.
3. Go to **Access**, then **Applications**, then **Add an application**, then **Self-hosted**:
   - Application domain: your custom domain, **and** add a second entry for `yourproject.pages.dev` and `*.yourproject.pages.dev`, so that the Cloudflare addresses are covered too.
   - Session duration: 1 month is sensible for the school office. Shorter is safer.
4. Add a policy with **Action: Allow** and **Include: Emails**, listing each person's email address: both parents, the school office, and any agencies.
5. Also, in the Pages project, go to **Settings**, then **General**, then **Access policy**, and switch it on for preview deployments.
6. Check it's working: open the site in a private browser window. You should see the Cloudflare sign-in page, not the rota.

### Adding or removing a viewer

Go to **Zero Trust**, then **Access**, then **Applications**, choose this app, then **Policies**, and edit the email list. A removed person can't get back in once their current session ends. To cut them off straight away, go to **Zero Trust**, then **My Team**, then **Users**, choose the person, and click **Revoke session**.

### Seeing who has looked

Go to **Zero Trust**, then **Logs**, then **Access**. This lists every sign-in with the email address and time. Only people with access to the Cloudflare account can see it. To let the other parent see it, invite them to the Cloudflare account with a read-only role.

## Backing up and restoring

There are only two things to keep:

1. **This repo.** GitHub keeps the full history of every change to `rota.json`, including who changed what and when, and you can undo any change from there. For an extra copy, use **Code**, then **Download ZIP**, now and then.
2. **The `ROTA_PEOPLE` value.** Keep it in your password manager.

To restore after losing everything, recreate the Cloudflare project (step 3) from the repo and paste `ROTA_PEOPLE` back in, then redo Access (step 4).

## For whoever maintains the code

This needs Node.js 22.18 or later, and nothing to install.

```sh
npm test               # rota engine, file loading and build tests
npm run build:example  # build with placeholder people data
npm run preview        # then open http://localhost:8788
```

To preview with real details on your own computer, put them in `people.local.json` (git ignores this file) and run `npm run build`.

| Path | What it is |
|---|---|
| `src/rota/engine.ts` | Works out who is responsible at any moment |
| `src/rota/time.ts` | UK time and clock-change handling |
| `src/rota/load.ts` | Reads `rota.json` and the people data, with plain-English errors |
| `src/app/` | The page: HTML, CSS, script, security headers |
| `scripts/build.ts` | Builds `dist/` for Cloudflare |

## Known limits of the simple version

- **Anyone who can edit the repo can change the rota on their own.** There is no two-parent confirmation step, but GitHub records who made each change and when. If you want the other parent to approve changes first, turn on branch protection with required reviews in GitHub.
- **Where the data lives.** Cloudflare serves the site from its worldwide network, so the people data is not held only in the UK or EU. It is minimal (names, phones and emails, with no addresses or photos) and can only be seen after signing in. Cloudflare signs the standard UK and EU data protection terms. If the school's data protection officer needs UK-only storage, that would need a different host.
- **No calendar feed.** Calendar apps can't get past the email sign-in.
