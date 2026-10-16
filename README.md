# Goonpilot

A personal booru viewer that runs on your own computer. No accounts, no cloud, no dependencies (just Node.js). Everything you like, save or change stays on your machine.

## What you need
- A computer to run it on (Windows, macOS or Linux) with **Node.js 18 or newer**: https://nodejs.org (LTS)
- A browser. Phones and tablets only open it, they don't run it (see [Phone](#phone-ios-and-android)).

## 1. Get it
Download the project (green **Code** button, then **Download ZIP**) and unzip it, or:
```
git clone <this repo's address>
cd <the folder>
```

## 2. Start it

| System | How |
|---|---|
| **Windows** | Double-click `start.bat` |
| **macOS** | Open Terminal in the folder, run `node server.mjs` |
| **Linux** | Open a terminal in the folder, run `node server.mjs` |

Then open **http://localhost:8787**. Stop it with `Ctrl+C` (or close the window on Windows).

## 3. Logins (optional)
Every site is tried with public access first. If a site refuses (rule34 usually wants a key), add your own keys:

1. Copy `.dev.vars.example` to `.dev.vars`
2. Fill in what you have, one `KEY=value` per line:
   `RULE34_API_KEY`, `RULE34_USER_ID`, `E621_USERNAME`, `E621_API_KEY`, `E6AI_USERNAME`, `E6AI_API_KEY`
3. Restart the server.

The file stays on your computer, is never sent to the browser, and is ignored by git.

## Phone (iOS and Android)
**Only needed if you want to use it on a phone or tablet. Skip this on a desktop.** The server stays on your computer; the phone just opens it through [Tailscale](https://tailscale.com) (free), a private link between your own devices. Nothing is exposed to the internet.

**Once:**
1. Install Tailscale on the computer **and** the phone (App Store / Google Play) and sign in with the **same account** on both.
2. In the Tailscale admin page (https://login.tailscale.com/admin/dns) turn on **MagicDNS** and **HTTPS Certificates**.

**Each time:**
- **Windows:** double-click `start-phone.bat`
- **macOS / Linux:** in the project folder run
  ```
  tailscale serve --bg 8787
  PHONE_MODE=1 node server.mjs
  ```
  (When you're done: `tailscale serve reset`.)

It prints an `https://….ts.net` address. Open it on the phone with the Tailscale app switched on. Only devices signed in to your Tailscale account can get in.

**Tip:** in Safari (iOS) use Share, **Add to Home Screen**. In Chrome (Android) use the menu, **Add to Home screen**. It then opens like an app.

The computer must stay awake and the server running while you use the phone.

## Image analysis (optional)
Lets the app read the look and tags of pictures to improve "For you". It runs fully on your computer; the AI model (~470 MB) is downloaded once.

- **Windows:** double-click `setup-vision.bat`
- **macOS / Linux:** start the server, then in a second terminal run
  ```
  npm install
  node scripts/vision-setup.mjs
  ```

Turn it off any time with `node scripts/vision-setup.mjs off`.

## Download your favorites
Open **For you**, then **♥ Liked** and pick a filter (Liked, Super, Disliked or All voted).
- **⬇ Download all**: everything in that filter as one ZIP (posts not saved locally yet are skipped).
- **☑ Select**: tick individual posts, then **⬇ Download selected**.
- **⬇ List (CSV)**: a small spreadsheet with a link and file address for each post.

A copy of your liked list is also kept up to date in `data/liked-list.csv`.

## Where your data lives
- Likes, dislikes and taste: `data/` in the project folder
- Saved searches, supertags and settings: your browser (localStorage)
- Your keys: `.dev.vars`

Back up `data/` if you care about it. Never share `data/` or `.dev.vars`. Both are ignored by git.

## Trouble
- **"node is not recognized" / "command not found":** install Node.js and open a new terminal.
- **Port already in use:** another copy is running. Close it, or start with `PORT=8788 node server.mjs` (Windows: `set PORT=8788` first).
- **A site returns an error:** add your login for it (step 3).
- **Phone can't connect:** Tailscale must be on for both devices and the server must be running.

## For developers
- `server.mjs`: local server, listens on 127.0.0.1 only
- `src/api.mjs`: API proxy; `src/sources/`: one adapter per site
- `src/foryou.mjs`: the "For you" recommender
- `public/`: the app (plain JavaScript, no libraries)
- Tests: `npm test`

## License
[![WTFPL](public/img/wtfpl-badge-88x31.png)](http://www.wtfpl.net/)

Do what you want. See [LICENSE](LICENSE). Credits are in [credits.md](credits.md).
