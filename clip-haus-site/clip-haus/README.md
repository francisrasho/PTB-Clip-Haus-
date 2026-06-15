# Clip Haus — Premium Barber Booking

Dark, neon-styled booking site + owner dashboard for Clip Haus (PTB).

Built with React + Vite. Bookings are saved in the browser's localStorage.

## Run it locally (VS Code)

1. Install [Node.js](https://nodejs.org) (LTS version) if you don't have it.
2. Open this folder in VS Code.
3. Open the built-in terminal (Ctrl + ` ) and run:

   ```
   npm install
   npm run dev
   ```

4. Open the URL it prints (usually http://localhost:5173).

## Owner dashboard

Scroll to the footer and tap **Owner login**. The PIN is `1234`
(change `ADMIN_PIN` near the top of `src/App.jsx`).

## Deploy to GitHub + Vercel

1. Create a new repo on github.com (e.g. `clip-haus`), then in the terminal:

   ```
   git init
   git add .
   git commit -m "Clip Haus booking site"
   git branch -M main
   git remote add origin https://github.com/YOUR_USERNAME/clip-haus.git
   git push -u origin main
   ```

2. Go to vercel.com → **Add New… → Project** → import the repo.
   Vercel auto-detects Vite — just press **Deploy**.

Every future `git push` to `main` redeploys automatically.

## Making future changes with Claude

The entire app lives in one file: `src/App.jsx`.

To make changes, paste the contents of `src/App.jsx` into a chat with
Claude (or re-attach it), describe what you want changed, and replace
this file with the updated version Claude gives back. Then:

```
git add . && git commit -m "describe the change" && git push
```

The file contains a small storage adapter at the top so the exact same
file also runs as a live preview inside Claude — no edits needed in
either direction.

## Heads-up: localStorage limitation

Bookings are stored **per browser**. A booking made on a customer's
phone will not appear on your dashboard on another device. This is fine
for trying it out or taking bookings on a single shop device. For a real
shared database (customers book anywhere, you see it everywhere), the
next step is adding a backend such as Supabase — Claude Code can convert
this project when you're ready.
