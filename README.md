# Ashram Baggage Custody

A volunteer-run digital ledger for baggage & valuables custody at ashram programs. It replaces the paper sign-in sheet at the counter while leaving the physical process — numbered tokens, hooks, a basket — completely unchanged. Residents can scan their existing ID card to check in instantly after a one-time registration; visitors and non-residents use a phone number instead. Offline-first, so a dropped wifi connection at the counter never stops a deposit or collection.

**Live demo:** [ashram-baggage-mvp.onrender.com](https://ashram-baggage-mvp.onrender.com) *(free-tier hosting — sleeps when idle, first load can take 30–60s to wake up)*
**Full walkthrough (screens, features, privacy model):** 'Prototype Walkthrough' attached with the submission form

Demo volunteer login: phone `+91 9999999999` — the 6-digit code is shown on-screen (no SMS gateway is wired up; this is a demo-mode stand-in).

## What it does

- **Deposit / Collect / Partial Collect** against a physical token number, with a live occupancy count so a volunteer knows before starting whether there's room.
- **Identify a customer three ways**, all resolving to the same record: scan a Resident ID card's QR code, type the Resident ID, or use a phone number. An unrecognized ID triggers a 10-second one-time registration (name + phone); every visit after that is instant.
- **Lost Token Recovery** as an explicit exception path — phone/ID lookup finds the active deposit, but release still requires a recovery note.
- **Storage & History** screens for occupancy visibility and a searchable transaction ledger (by phone, token, name, or Resident ID).
- **Admin settings**: capacity, retention period, abandoned-item threshold, privacy notice, a Volunteer Directory (up to 3 admins), and a separate Resident ID Directory.
- **Offline-first**: every write (deposits, collections, resident registration, admin setting changes) queues locally if the connection drops and syncs automatically once it's back — nothing is lost, nothing fails silently.
- **Privacy by construction**: phone numbers are masked (`••1234`) everywhere they're displayed. Automatic purge only ever touches completed *transactions* (redacting phone/name after the retention window) — the Volunteer and Resident directories are separate, permanent records by design, since that permanence is what makes repeat scans instant.

See the [full walkthrough](https://claude.ai/code/artifact/af42e01d-0670-49dd-909b-f46c79ca2e90) for a screen-by-screen tour and the reasoning behind the privacy model.

## Running it locally

```bash
npm install
npm start
```

Then open `http://localhost:3000`. A `data.json` file is created automatically on first run, seeded with one admin volunteer (`+919999999999`).

## Project structure

```
server.js         Express server + all API routes, single JSON-file datastore
public/index.html Entire client app (HTML/CSS/JS, no build step)
data.json          Runtime data — gitignored, regenerates with defaults if missing
render.yaml        Render deployment config
```

## Tech stack

- **Frontend**: HTML5, CSS3 (mobile-first grid/flexbox), vanilla JavaScript (ES6+), Fetch API, Web Storage API (localStorage)
- **Backend**: Node.js + Express
- **Data layer**: a single JSON file via the `fs` module — zero native database dependencies, so it installs and runs anywhere with just Node
- **Scanning**: [qr-scanner](https://github.com/nimiq/qr-scanner) for camera-based QR capture (chosen for its reliability on iOS Safari, which has no native `BarcodeDetector` API)
- **Hosting**: [Render](https://render.com) free tier

## What this needs before production

This is a working prototype proving the product idea, not yet a production deployment. Before it holds anyone's real belongings it would need: a real datastore in place of the single JSON file (concurrent writes at volume), signed session tokens tied to verified OTP instead of trusting a client-supplied phone number, a real SMS gateway, and persistent storage instead of Render's free-tier ephemeral disk. See the "Path to Production" section of the [walkthrough doc](https://claude.ai/code/artifact/af42e01d-0670-49dd-909b-f46c79ca2e90) for the full breakdown.
