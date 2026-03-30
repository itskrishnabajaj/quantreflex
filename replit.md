# QuantReflex

A Progressive Web App (PWA) for training mental math reflexes for competitive exams (CAT, GMAT, MBA CET, NTSE, Math Olympiads) and school students.

## Project Overview

- **Type:** PWA (HTML5 + CSS3 + Vanilla JavaScript) with Express backend
- **Express server** (`server.js`) serves static files and AI API endpoints
- **Firebase** (v10 compat) for Auth, Firestore sync, and Cloud Messaging
- **Google Gemini** AI for word problems, mistake explanations, and performance insights
- **localStorage** for offline-first data persistence
- **Service Worker** for offline caching
- **Razorpay** for premium payment processing

## Project Structure

```
/               - Root with index.html (SPA entry point), manifest.json, service-worker.js, server.js
/js/            - Application logic (app.js, router.js, drill-engine.js, questions.js, ai-features.js, etc.)
/services/      - Backend services (aiService.js — Gemini API wrapper)
/css/           - Styles (style.css with CSS variables for themes and dark mode)
/appicons/      - PWA app icons
/icons/         - Navigation and UI icons
/sounds/        - Audio feedback files
```

## Running the App

The app is served via Express (Node.js):

```
node server.js
```

Workflow: **Start application** → `node server.js` → port 5000 (webview)

## Deployment

Configured as **autoscale** deployment with `run: ["sh", "-c", "node server.js"]`.

## Firebase Setup

Firebase configuration is embedded in the JS files. See `FIREBASE_SETUP.md` for instructions on setting up your own Firebase project if needed.

## Product Upgrade (March 2026)

### Practice Tab
- **Scroll fix**: Drill container scrolls properly when custom numpad overlaps content
- **Focus Training flow**: Category selection → timer selection → Start button (no longer auto-starts on category click)
- **Glassmorphic training card**: Focus & Custom modes open in a fixed centered card overlay with scrollable body and Back button at bottom
- **Timer redesign**: Toggle switch (on/off) + pill selector (Per Ques. / Total) + numeric seconds input — replaces old 6-button grid
- **Timer premium lock**: Timer toggle in Focus Mode is premium-only; free users see paywall popup
- **Swipe disabled** during Focus/Custom category selection screens

### Paywall & Limits
- **Daily limit**: 25 free questions/day enforced in `startDrillFromPractice()` via `hasReachedDailyLimit()` from paywall.js
- **Daily limit banner**: Yellow/amber banner shown above mode selector when limit reached
- **First-login paywall**: `showFirstLoginPaywall()` called once from `_revealMainApp()` for new users
- **Paywall badge**: Gradient pill style (blue→purple) instead of plain text
- **Paywall headline**: "Train your brain like a top performer"
- **Daily goal cap**: Free users capped at <30 (max 20 with step 10); >= 30 triggers paywall
- **Table modal lock**: Triple-tap full-screen table modal is premium-only
- **Locked features**: `focus_timer`, `table_modal` added to `_LOCKED_FEATURES`

### Onboarding
- Name field is REQUIRED on both Next AND Skip (validation shown if empty)
- Daily goal options changed to 10/20/25 (default 20)
- Wrong answer on screen 6 redirects to Learn tab (not Practice)

### Settings & Profile
- App Guide rewritten for broader audience (school/NTSE/Olympiad/CAT/GMAT)
- App Guide Practice Modes order: Focus Training → Custom Training → Review Mistakes
- Custom Training section merged into Practice Modes (removed standalone section)
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
- `_timerPillMode`: 'per' or 'total' — tracks active timer pill

## App Update System (March 2026)

- **Fully manual**: App never auto-updates or auto-reloads. User must click "Update App" in Settings.
- **Service worker version**: `APP_VERSION` constant in `service-worker.js` (currently v59). Increment on each update.
- **No auto skipWaiting**: `self.skipWaiting()` removed from install handler. New SW waits until user triggers update.
- **No controllerchange reload**: Auto-reload on SW swap removed. Only explicit `window.location.reload()` from Update button.
- **Cache name**: `quant-reflex-` + `APP_VERSION` — old caches cleaned on activate.
- **Update toast**: Shows once per session (`updateToastShown` localStorage flag) when new SW is `installed` and controller exists. Clicking navigates to Settings. Auto-dismissed after 8s.
- **Update App button**: Settings > App. Clears all caches → sends `SKIP_WAITING` → sets `appUpdating` flag → reloads.
- **Post-update feedback**: On reload, if `appUpdating` flag is set, shows "App updated successfully" toast and clears the flag.
- **Navigation caching**: `index.html` fetched network-first with `cache: 'no-cache'`. Cached copy kept for offline fallback.
- **Premium popup guard**: `showPaywall()` returns early if user is premium/paid/earlyUser/active-trial.

## Final Polish Pass (March 2026)

### Settings Button UI Refinement
- **Update App** and **Clear Data** buttons now show small description text in brackets below the label
- Divider lines removed between Logout, Delete Account, Update App, and Clear Data buttons
- Button uses flex column layout with `.settings-action-with-desc`, `.settings-btn-label`, `.settings-btn-desc` classes

### Drill Layout Redesign (Numpad Overlap Fix)
- `#drillContainer` uses `position: fixed` during drill sessions, filling viewport above numpad
- Question HTML restructured: scrollable `.drill-question-scroll` area + pinned `.drill-actions` area
- Submit/Skip/Next buttons are ALWAYS visible — never scroll behind the numpad
- Card uses flex column layout: scroll area gets `flex: 1; overflow-y: auto`, actions get `flex-shrink: 0`
- Explicit background colors for all theme variants (classic, dark, playful, playful-dark)
- Applied to all modes: Quick Drill, Reflex Drill, Timed Test, Focus Training, Custom Training, Review Mistakes
- Start screen and results screen unaffected (they call `_exitDrillSession()` which removes drill layout)

### Premium Popup Hard Lock
- `canAccess()` in `paywall.js` now checks `isPremium === true` FIRST, before any other checks
- `showPaywall()` returns immediately if `isPremium === true` — no popup ever shown for premium users
- `showFirstLoginPaywall()` also guards on `isPremium` first
- Applied globally: all feature locks, timer toggle, daily goal, learn tab, stats tab

### Modal Bottom Blur Removal
- Removed `::after` gradient overlay from `.info-modal-scroll` and `.modal-content` across all themes (classic, playful, dark mode variants)
- Modals now show clean edge-to-edge content without bottom blur/gradient artifacts
- Scrolling still works properly in all modals

### App Guide Content Improvement
- Expanded "Getting Started" with clear audience list: CAT/GMAT/MBA, placement prep, school students, NTSE/Olympiad, general aptitude
- Each practice mode now includes "Improves:" line describing what it builds
- Premium features marked with 🔒 throughout: practice modes, learn tab, analytics, settings
- Added dedicated "Premium Features Summary" section listing all locked features
- Improved readability with consistent em-dash formatting and cleaner spacing

### Workflow Change
- Switched from `python3 -m http.server` to `serve . -l 5000 -s` (Node.js) due to python3 unavailability in environment
- Switched from `serve` to `node server.js` (Express) for AI API endpoints

## AI Features Integration (March 2026)

### Architecture
- **Backend**: Express server (`server.js`) serves static files + 3 AI API endpoints
- **AI Service**: `services/aiService.js` wraps Google Gemini (`gemini-2.0-flash`) with JSON parsing and retry logic
- **Client Module**: `js/ai-features.js` handles quota tracking, API calls, and UI rendering
- **Environment Variable**: `GEMINI_API_KEY` — server-side only, never exposed to client

### API Endpoints
- `POST /api/ai/word-problems` — Generates contextual word problems for a given category/difficulty
- `POST /api/ai/explain` — Explains a math mistake step-by-step
- `POST /api/ai/insights` — Generates personalized performance insights from stats

### AI Features
- **Word Problems Mode** (Practice tab): AI-generated contextual word problems; 5 free lifetime uses, 30/day for premium
- **Mistake Explainer** (Drill): "Explain" button appears after wrong answers; premium-only (`ai_explain` feature key)
- **AI Coach** (Home tab): Personalized coaching card with tips; premium-only (`ai_coach` feature key)
- **AI Insights** (Stats tab): Performance analysis with focus areas and action items; premium-only, cached 24hrs in localStorage

### Paywall Feature Keys
- `ai_explain` — Mistake Explainer (premium lock)
- `ai_coach` — AI Coach card (premium lock)
- Word Problems uses its own quota system (not paywall-gated)

## Replit Migration Notes (March 2026)

- Added a 5-second timeout fallback in `js/app.js` for Firebase Auth initialization. If `onAuthStateChanged` doesn't fire within 5 seconds (e.g., in sandboxed preview environments), the app falls back to showing the login screen rather than hanging indefinitely on the splash screen.

## Security Fixes Applied (March 2026)

### Critical: Plaintext Password Removed from Firestore
- **Root cause:** After login/signup, the user's plaintext password was captured in `_pendingPassword` and pushed to Firestore via `FirestoreSync.updateProfilePassword()`. The Profile modal in settings then read it back from cache and pre-filled the password field.
- **Files changed:** `js/app.js`, `js/settings.js`, `js/firestore-sync.js`
- **Fix:** Removed the `_pendingPassword` capture-and-sync mechanism entirely. Password changes now go through Firebase Auth only (`Auth.getCurrentUser().updatePassword()`). The `updateProfilePassword` function in `firestore-sync.js` is now a documented no-op. The profile modal password field now starts empty instead of pre-filled from Firestore.
- **No features broken:** Password changes still work via Firebase Auth. The profile modal still allows changing name and password — it just no longer leaks the password into Firestore.
