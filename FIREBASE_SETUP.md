# Firebase Setup Guide for Quant Reflex Trainer

This guide walks you through setting up Firebase Authentication and Firestore for the Quant Reflex Trainer PWA.

---

## Prerequisites

- A Google account
- A web browser

---

## Step 1: Create a Firebase Project

1. Go to the [Firebase Console](https://console.firebase.google.com/).
2. Click **Add project**.
3. Enter a project name (e.g., `quant-reflex-trainer`).
4. Optionally enable Google Analytics, then click **Create project**.
5. Once created, click **Continue**.

---

## Step 2: Register a Web App

1. In the Firebase Console, click the **Web** icon (`</>`) to add a web app.
2. Enter an app nickname (e.g., `Quant Reflex Trainer`).
3. Optionally check **Also set up Firebase Hosting**.
4. Click **Register app**.
5. Firebase will display your config object. It looks like this:

```javascript
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "your-project.firebaseapp.com",
  projectId: "your-project-id",
  storageBucket: "your-project.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abcdef123456"
};
```

6. Copy these values into `js/firebase.js`, replacing the existing `firebaseConfig` object.

---

## Step 3: Enable Firebase Authentication

1. In the Firebase Console sidebar, click **Build → Authentication**.
2. Click **Get started**.
3. Under **Sign-in method**, click **Email/Password**.
4. Enable the **Email/Password** toggle.
5. Click **Save**.

> **Note:** The app converts usernames to email format internally (e.g., `username@quantreflex.app`). Users never see or enter an email — they use a simple username and password.

---

## Step 4: Create the Firestore Database

1. In the Firebase Console sidebar, click **Build → Firestore Database**.
2. Click **Create database**.
3. Choose a location closest to your users (e.g., `asia-south1` for India).
4. Select **Start in test mode** for development (you will tighten rules in Step 5).
5. Click **Enable**.

---

## Step 5: Set Up Firestore Security Rules

For production, update the Firestore rules to restrict access. Go to **Firestore Database → Rules** and set:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Users can only read/write their own documents
    match /users/{userId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;

      // Subcollections (e.g., practiceSessions) inherit the same rule
      match /{subcollection=**} {
        allow read, write: if request.auth != null && request.auth.uid == userId;
      }
    }

    // Deny access to all other collections
    match /{document=**} {
      allow read, write: if false;
    }
  }
}
```

### Security Rules Explanation

| Rule | Purpose |
|------|---------|
| `request.auth != null` | Only authenticated users can access the database |
| `request.auth.uid == userId` | Users can only access their own documents |
| `match /{subcollection=**}` | Applies the same rule to all subcollections (e.g., `practiceSessions`) |
| `match /{document=**} allow: false` | Denies access to any collection not explicitly allowed |

### Best Practices for Scaling

- **Separate growing data into subcollections:** Practice sessions are stored in `users/{userId}/practiceSessions/{sessionId}` to prevent the main user document from becoming too large.
- **Limit document size:** Firestore documents have a 1 MB size limit. Keep arrays (like `mistakes`, `responseTimes`) capped.
- **Use batch writes:** The app uses debounced batch writes to minimize Firestore write operations.
- **Enable offline persistence:** Already enabled in the app code for PWA support.

### Deploying Rules Safely

1. Test rules in the Firebase Console **Rules Playground** before deploying.
2. Use the Firebase CLI for version-controlled deployments:
   ```bash
   firebase deploy --only firestore:rules
   ```
3. Monitor rule evaluation in **Firestore → Usage** to detect issues.
4. Never use `allow read, write: if true` in production.

---

## Step 6: Enable Offline Persistence

Offline persistence is already enabled in the app code (`js/firebase.js`). Firestore will automatically:

- Cache data locally for offline access
- Queue writes made while offline
- Sync data when the connection is restored

No additional setup is needed.

---

## Step 7: Verify the Setup

1. Open the app in a browser.
2. You should see the login screen.
3. Create an account with a username and password.
4. Open the browser Developer Tools → Console — no Firebase errors should appear.
5. Go to the Firebase Console → Authentication → Users — you should see your new account.
6. Go to Firebase Console → Firestore Database → Data — you should see a document under the `users` collection with your user UID.

---

## Firestore Database Structure

```
users/
  └── {userId}/                      (Firebase Auth UID)
        ├── profile
        │     ├── username           (display username)
        │     ├── name               (optional display name)
        │     ├── createdAt          (account creation date)
        │     └── passwordHash       (optional, hashed only — never plain text)
        ├── access
        │     ├── userNumber         (auto-incremented user index)
        │     ├── isPremium          (boolean)
        │     ├── isTrial            (boolean)
        │     ├── isEarlyUser        (boolean)
        │     ├── trialEnd           (timestamp|null)
        │     └── hasPaid            (boolean)
        ├── settings
        │     ├── darkMode           (boolean)
        │     ├── sound              (boolean)
        │     ├── vibration          (boolean)
        │     ├── difficulty         (string: easy/medium/hard)
        │     ├── dailyGoal          (number)
        │     ├── skipEnabled        (premium feature flag)
        │     ├── notificationsEnabled (boolean)
        │     ├── reducedMotion      (boolean)
        │     ├── onboardingCompleted (boolean)
        │     └── theme              (string: classic/playful)
        ├── stats
        │     ├── totalAttempted     (number)
        │     ├── totalCorrect       (number)
        │     ├── bestStreak         (number)
        │     └── bestDailyStreak    (number)
        ├── categoryStats            (map: category → {attempted, correct, accuracy})
        ├── dailyHistory             (map: date → {attempted, correct, dailyStreak})
        ├── mistakes                 (array)
        ├── responseTimes            (array)
        ├── quickLinks               (array of selected quick link IDs)
        ├── customTopics             (array of user-created topic objects)
        ├── customFormulas           (map: topicId → array of formula objects)
        ├── bookmarks                (array of bookmarked formula IDs)
        │
        └── practiceSessions/        (subcollection)
              └── {sessionId}/
                    ├── mode         (string)
                    ├── category     (string, optional)
                    ├── score        (number)
                    ├── total        (number)
                    ├── duration     (number)
                    ├── date         (string)
                    └── timestamp    (string, ISO 8601)
```

---

## How Authentication Works

- Users create an account with a **username** and **password**.
- The app converts the username to an email format internally (e.g., `john_doe` → `john_doe@quantreflex.app`).
- Firebase Authentication handles password hashing and session management.
- Login persists across browser sessions using Firebase Auth's `LOCAL` persistence.
- If browser data is cleared, users can log in again and all their data is restored from Firestore.
- A **Logout** button is available in the Settings tab.

---

## Data Synchronization

The app uses a hybrid storage strategy:

1. **App launch** → Load cached data from localStorage immediately → Render UI
2. **Background sync** → Load data from Firestore → Update localStorage cache
3. **Data changes** → Write to localStorage immediately → Queue Firestore update (debounced 2s)
4. **Drill mode** → Defer Firestore writes until drill ends → Flush all updates at once

This ensures the UI is always fast while data stays synchronized.

---

## Data Recovery

If localStorage is cleared (e.g., user clears browser data):

1. User logs in again with their username and password.
2. All data is automatically reloaded from Firestore.
3. localStorage cache is rebuilt.
4. No progress is lost.

---

## In-App Data Clearing

Users can clear their data through the Settings tab:

| Option | What it clears |
|--------|---------------|
| **Clear Statistics** | Resets all progress, streaks, and performance history |
| **Clear Formulas & Tips** | Deletes custom topics and added formulas |
| **Clear Entire App Data** | Resets everything: settings, stats, formulas, bookmarks |

Data clearing requires confirmation to prevent accidental deletion.
The user account is never deleted — only app data is cleared.

---

## Troubleshooting

| Issue | Solution |
|---|---|
| Firebase not initializing | Check that the Firebase SDK scripts load before `firebase.js` in `index.html` |
| Console says "Firebase not configured" | Verify `firebaseConfig` values in `js/firebase.js` |
| Login fails with "Authentication service not available" | Ensure `firebase-auth-compat.js` is loaded in `index.html` |
| Account creation fails | Verify Email/Password sign-in is enabled in Firebase Console → Authentication |
| Firestore writes failing | Check Firestore rules in the Firebase Console |
| Offline mode not working | Ensure only one tab is open (multi-tab persistence requires `synchronizeTabs: true`, which is already enabled) |
| Data not syncing | Check network connectivity and Firestore Console for the user document |

---

## Firebase SDK Version

The app uses Firebase JavaScript SDK **v10.12.2** (compat build) loaded via CDN:

```html
<script src="https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js"></script>
<script src="https://www.gstatic.com/firebasejs/10.12.2/firebase-auth-compat.js"></script>
<script src="https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore-compat.js"></script>
```

The compat build is used for maximum browser compatibility with the vanilla JavaScript architecture.
