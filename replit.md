# QuantReflex

A Progressive Web App (PWA) for training mental math reflexes for competitive exams (CAT, GMAT, CET).

## Project Overview

- **Type:** Static PWA (HTML5 + CSS3 + Vanilla JavaScript)
- **No build system** — pure static files served directly
- **Firebase** (v10 compat) for Auth, Firestore sync, and Cloud Messaging
- **localStorage** for offline-first data persistence
- **Service Worker** for offline caching

## Project Structure

```
/               - Root with index.html (SPA entry point), manifest.json, service-worker.js
/js/            - Application logic (app.js, router.js, drill-engine.js, questions.js, firebase.js, auth.js, etc.)
/css/           - Styles (style.css with CSS variables for themes and dark mode)
/appicons/      - PWA app icons
/icons/         - Navigation and UI icons
/sounds/        - Audio feedback files
```

## Running the App

The app is served via Python's built-in HTTP server:

```
python3 -m http.server 5000 --bind 0.0.0.0
```

Workflow: **Start application** → port 5000 (webview)

## Deployment

Configured as a **static** deployment with `publicDir: "."` (root directory).

## Firebase Setup

Firebase configuration is embedded in the JS files. See `FIREBASE_SETUP.md` for instructions on setting up your own Firebase project if needed.
