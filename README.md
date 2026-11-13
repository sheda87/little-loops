# Little Loops

A cozy crochet companion for your phone, made for amigurumi lovers.

- **Seasonal look**: cozy autumn now, switching to winter, spring and summer on its own through the year
- **Home**: a friendly landing page with a time-of-day greeting, cozy and playful messages, and every work in progress at a glance
- **Counters**: big tap-friendly counters for rounds and stitches, with optional goals. Every project has its own counters, and there's a quick counter on Home
- **Learn**: how-to guides (magic ring, increases, invisible decrease, stuffing, safety eyes and more) plus an abbreviations cheat sheet with US and UK names
- **Projects**: a library with photos, pattern notes (yarn, hook size, source) and a round-by-round checklist
- **Yarn stash**: track what you have, by color and number of skeins
- **Backup**: save everything to a file and restore it on any phone
- **Works offline** and installs on the iPhone home screen like a real app

Everything is stored on the phone itself. Nothing is uploaded anywhere, and there are no accounts.

---

## What's in this folder

| File | What it does |
| --- | --- |
| `index.html` | The page itself: header, bottom tabs, and empty spots the app fills in |
| `styles.css` | The look: fonts, spacing and the seasonal color themes (one block per season at the top) |
| `app.js` | The behavior: counters, guides, projects, yarn, saving, backup |
| `manifest.webmanifest` | Tells the phone this is an installable app (name, icon, colors) |
| `sw.js` | The "service worker" that lets the app open with no internet |
| `icons/` | The home screen icons |

There is no build step and nothing to install. It is plain HTML, CSS and JavaScript.

---

## Try it on your computer first

Open a terminal in this folder and run:

```bash
python3 -m http.server 8000
```

Then open <http://localhost:8000> in your browser. Press `Ctrl+C` in the terminal to stop it.

Tip: in Chrome, press `F12`, click the phone icon in the toolbar to see it at phone size. If something looks wrong, check the Console tab for red error messages. The last line of an error says what went wrong, and the file name and line number say where.

---

## Publish it on GitHub Pages

GitHub Pages hosts the app for free at a web address your friend can open on her phone.

### 1. Create a repository

1. Sign in at <https://github.com>.
2. Click the **+** at the top right, then **New repository**.
3. Name it `little-loops`, keep it **Public** (free Pages hosting needs this on most accounts), and click **Create repository**. Don't add a README, since this folder already has one.

### 2. Upload the files

Option A, using the terminal (good practice for the git commands):

```bash
cd little-loops            # go into this folder
git init                   # start tracking changes
git add .                  # stage every file
git commit -m "First version of Little Loops"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/little-loops.git
git push -u origin main    # upload
```

Replace `YOUR-USERNAME` with your GitHub username. Use `git status` any time to see what has changed.

Option B, in the browser: on the empty repository page, click **uploading an existing file** and drag in everything from this folder, including the `icons` folder. Then click **Commit changes**.

### 3. Turn on Pages

1. In the repository, open **Settings**, then **Pages** in the left menu.
2. Under **Build and deployment**, set **Source** to **Deploy from a branch**.
3. Pick the **main** branch and the **/ (root)** folder, then click **Save**.
4. Wait a minute or two, then refresh the page. A banner shows the address, which looks like:

```
https://YOUR-USERNAME.github.io/little-loops/
```

Open it on your own phone first to check that it works.

---

## Install it on an iPhone

Your friend needs to do this in **Safari**. Other browsers on iPhone can't install apps to the home screen.

1. Open the address above in Safari.
2. Tap the **Share** button (the square with an arrow pointing up).
3. Scroll down and tap **Add to Home Screen**, then **Add**.

Little Loops now opens full screen from its own icon and works without internet.

---

## Backups matter

Projects and photos are stored on the phone only. If the phone is lost, reset, or if iOS clears website data, they are gone. Use the gear icon at the top right, then **Save a backup**, and choose **Save to Files** or email it to herself. The app shows a reminder if it has been more than 30 days.

To move to a new phone, open the app there, tap the gear, and choose **Restore from a backup**.

Photos are shrunk to about 1200 pixels on the long side so they stay small.

---

## Changing things

- **Seasonal themes**: the app picks autumn (Sep to Nov), winter (Dec to Feb), spring (Mar to May) or summer (Jun to Aug) from the date. Each season is a block at the top of `styles.css` that starts with `[data-theme="autumn"]` and lists every color the app uses. Change a color there and the whole app follows. In the app, the gear icon has a **Season look** setting to lock one season.
- **Add a holiday theme** (Thanksgiving, Christmas and so on): copy a season block in `styles.css`, rename it, for example `[data-theme="christmas"]`, and change the colors. Then add one line for it to `THEMES` in `app.js`, with a label, a header color and a motif (a small picture used on empty screens), and it shows up in Settings. To switch on by date automatically, edit `seasonOf` in `app.js`.
- **How-to guides**: edit the `GUIDES` list in `app.js`. Each guide has a title, a category, steps and a tip.
- **Abbreviations**: edit the `ABBR` and `USUK` lists in `app.js`.
- **Welcome messages and cheers**: edit the `HOME_LINES`, `CHEERS` and `FINISH_CHEERS` lists in `app.js`.
- **After you change any file**: if the app doesn't show the change on the phone, close it fully and open it again. If it is still old, change the version in `CACHE = 'little-loops-v4'` in `sw.js` to `v5` (then `v6`, and so on) and push again.

Make small changes and test after each one. Commit every time something works (`git add .` then `git commit -m "what you changed"`), so you can always roll back.

---

## Ideas for later

- **AI design helper**: describe a creature and get a round-by-round amigurumi pattern, or upload a photo and get a pattern that approximates it. This needs a small server to keep an API key private, because anything in a public repository can be read by anyone. A free Cloudflare Worker can do that job.
- **Synced accounts**: so projects follow her across phones (needs a database and logins).
- A sphere and circle calculator that writes out the increase rounds for any size.
- Edit rounds in the checklist, and link a counter to a project.
