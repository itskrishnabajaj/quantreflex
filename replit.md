# QuantReflex

A Progressive Web App (PWA) for training mental math reflexes for competitive exams (CAT, GMAT, MBA CET, NTSE, Math Olympiads) and school students.

## Project Overview

- **Type:** Static PWA (HTML5 + CSS3 + Vanilla JavaScript)
- **No build system** — pure static files served directly
- **Firebase** (v10 compat) for Auth, Firestore sync, and Cloud Messaging
- **localStorage** for offline-first data persistence
- **Service Worker** for offline caching
- **Razorpay** for premium payment processing

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

## Product Upgrade (March 2026)

### Practice Tab
- **Scroll fix**: Drill container scrolls properly when custom numpad overlaps content
- **Focus Training flow**: Category selection → timer selection → Start button (no longer auto-starts on category click)
- **Timer selection**: 6 options (No Timer, 15s/Q, 30s/Q, 1 min, 3 min, 5 min) shared by Focus & Custom modes; parsed as `perQuestionSec` or `timeLimitSec` in `startDrillFromPractice()`
- **Swipe disabled** during Focus/Custom category selection screens

### Paywall & Limits
- **Daily limit**: 25 free questions/day enforced in `startDrillFromPractice()` via `hasReachedDailyLimit()` from paywall.js
- **Daily limit banner**: Yellow/amber banner shown above mode selector when limit reached
- **First-login paywall**: `showFirstLoginPaywall()` called once from `_revealMainApp()` for new users
- **Paywall badge**: Gradient pill style (blue→purple) instead of plain text
- **Paywall headline**: "Train your brain like a top performer"

### Onboarding
- Name field is REQUIRED (validation shown if empty)
- Daily goal options changed to 10/20/25 (default 20)
- Wrong answer on screen 6 redirects to Learn tab (not Practice)

### Settings & Profile
- App Guide rewritten for broader audience (school/NTSE/Olympiad/CAT/GMAT)
- Custom Training section added to App Guide
- Profile password stored in Firestore with intentional UX comment

### Question Quality
- Anti-repetition buffer increased from 8 to 20
- Squares: occasional √ (square root) reverse questions on medium/hard
- Cubes: occasional ∛ (cube root) reverse questions on medium/hard
- Multiplication: occasional division variant on medium/hard

### Key State Variables (app.js)
- `_focusModeActive`: true when Focus Training category selection is open
- `_focusSelectedCategory` / `_focusSelectedCategoryLabel`: currently selected category in Focus mode
- `_selectedTimerOption`: current timer selection (e.g., 'none', 'per:15', 'total:180')

## Replit Migration Notes (March 2026)

- Added a 5-second timeout fallback in `js/app.js` for Firebase Auth initialization. If `onAuthStateChanged` doesn't fire within 5 seconds (e.g., in sandboxed preview environments), the app falls back to showing the login screen rather than hanging indefinitely on the splash screen.

## Security Fixes Applied (March 2026)

### Critical: Plaintext Password Removed from Firestore
- **Root cause:** After login/signup, the user's plaintext password was captured in `_pendingPassword` and pushed to Firestore via `FirestoreSync.updateProfilePassword()`. The Profile modal in settings then read it back from cache and pre-filled the password field.
- **Files changed:** `js/app.js`, `js/settings.js`, `js/firestore-sync.js`
- **Fix:** Removed the `_pendingPassword` capture-and-sync mechanism entirely. Password changes now go through Firebase Auth only (`Auth.getCurrentUser().updatePassword()`). The `updateProfilePassword` function in `firestore-sync.js` is now a documented no-op. The profile modal password field now starts empty instead of pre-filled from Firestore.
- **No features broken:** Password changes still work via Firebase Auth. The profile modal still allows changing name and password — it just no longer leaks the password into Firestore.
