# Quant Reflex Trainer

A Progressive Web App (PWA) that trains mental math reflexes for competitive exams like CET, CAT, and GMAT. Built with vanilla HTML, CSS, and JavaScript — no frameworks.

## Features

- **Reflex Drills** — 10-question speed drills with per-question timer and instant feedback
- **Learn Shortcuts** — Fractions-to-percentage table, squares (11²–30²), cubes (1³–15³), and mental multiplication tricks
- **Timed Test** — 10 questions with a 3-minute countdown
- **Daily Warmup** — Quick 10-question warm-up session
- **Formula Vault** — Key mental math formulas at a glance
- **Progress Tracking** — Accuracy, streak, and attempt counts stored in localStorage

## Run Locally

1. Serve the `quant-reflex/` folder with any static HTTP server:
   ```bash
   # Python 3
   cd quant-reflex
   python -m http.server 8080

   # Node.js (npx)
   npx serve quant-reflex
   ```
2. Open `http://localhost:8080` in your browser.

## Install as a Mobile App

1. Open the app URL in Chrome / Edge on your phone.
2. Tap the **Install App** button (or use the browser menu → "Add to Home Screen").
3. The app will appear on your home screen and work offline.

## File Structure

```
quant-reflex/
├── index.html          Home page with navigation
├── learn.html          Shortcuts and formulas reference
├── drill.html          Reflex drill page
├── test.html           Timed test page
├── progress.html       Progress dashboard
├── style.css           Mobile-first responsive styles
├── app.js              Service worker registration & install prompt
├── questions.js        Random question generator
├── drill-engine.js     Drill/test engine (timer, scoring, feedback)
├── progress.js         localStorage progress tracking
├── manifest.json       PWA manifest
└── service-worker.js   Offline caching service worker
```