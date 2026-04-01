# QuantReflex

A Progressive Web App (PWA) that trains mental math reflexes for competitive exams like CET, CAT, and GMAT.

## Tech Stack

- **Frontend:** Vanilla HTML5, CSS3, JavaScript (no frameworks) — SPA architecture via `js/router.js`
- **Backend:** Node.js + Express (server.js)
- **Database & Auth:** Firebase (Authentication + Firestore)
- **AI:** Google Gemini (`@google/generative-ai`) via server-side API endpoints
- **PWA:** Service worker + `manifest.json` for offline support and home screen installation

## Project Structure

```
index.html          # Main SPA entry point (all views as hidden/visible divs)
server.js           # Express server — static files + AI API endpoints
css/style.css       # Mobile-first responsive styles
js/
  app.js            # Main frontend entry, PWA install prompt
  router.js         # Client-side SPA router
  auth.js           # Firebase auth logic
  firebase.js       # Firebase config/initialization
  firestore-sync.js # localStorage <-> Firestore background sync
  drill-engine.js   # Drill timer, scoring, feedback logic
  questions.js      # Random question generator (12 categories)
  ai-features.js    # Frontend calls to AI API endpoints
services/
  aiService.js      # Server-side Gemini AI + Firestore quota/cache logic
```

## Running the App

The app runs on port 5000 via `node server.js`. The workflow "Start application" manages this.

## Environment Variables / Secrets

- `GEMINI_API_KEY` — Google Gemini API key (stored as a Replit Secret)

## Key Features

- 12 math categories: squares, cubes, area, volume, percentages, multiplication, fractions, averages, ratios, profit-loss, time-speed-distance, time-and-work
- Drill mode, timed tests, and learn mode
- Firebase authentication (username mapped to dummy email format)
- AI-generated word problems, step-by-step explanations, and performance insights (premium features)
- Cross-device sync via Firestore; offline-first via localStorage

## App Guide Modal (Task #8)

The App Guide modal (`id="appGuideModal"`) was redesigned in Task #8:
- Premium Features Summary replaced with two structured tier sections: Premium (₹79 Lifetime) and Premium+ AI Layer
- Section A (Premium): 4 grouped feature blocks — Core Training Power, Performance & Feedback, Control & Flexibility, Experience — with 🔓 icons and outcome-driven copy
- Section B (AI): AI Learning System with 4 AI features using 🤖 icons
- New CSS classes: `guide-premium-section`, `guide-ai-tier`, `guide-premium-header`, `guide-tier-badge`, `guide-tier-title`, `guide-tier-subtitle`, `guide-feature-group`, `guide-feature-group-label`, `guide-feature-row`, `guide-feature-icon`, `guide-feature-info`, `guide-feature-name`, `guide-feature-desc`, `guide-tier-footer`, `guide-tier-cta-note`
- All CSS classes have dark-mode and theme-playful variants
- All other guide sections tightened to outcome-driven language; 🔒 → 🔓 throughout
- Service worker bumped to v61
