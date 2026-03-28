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

## Replit Migration Notes (March 2026)

- Added a 5-second timeout fallback in `js/app.js` for Firebase Auth initialization. If `onAuthStateChanged` doesn't fire within 5 seconds (e.g., in sandboxed preview environments), the app falls back to showing the login screen rather than hanging indefinitely on the splash screen.

## Security Fixes Applied (March 2026)

### Critical: Plaintext Password Removed from Firestore
- **Root cause:** After login/signup, the user's plaintext password was captured in `_pendingPassword` and pushed to Firestore via `FirestoreSync.updateProfilePassword()`. The Profile modal in settings then read it back from cache and pre-filled the password field.
- **Files changed:** `js/app.js`, `js/settings.js`, `js/firestore-sync.js`
- **Fix:** Removed the `_pendingPassword` capture-and-sync mechanism entirely. Password changes now go through Firebase Auth only (`Auth.getCurrentUser().updatePassword()`). The `updateProfilePassword` function in `firestore-sync.js` is now a documented no-op. The profile modal password field now starts empty instead of pre-filled from Firestore.
- **No features broken:** Password changes still work via Firebase Auth. The profile modal still allows changing name and password — it just no longer leaks the password into Firestore.
