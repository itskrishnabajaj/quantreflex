# Firebase Setup Guide for Quant Reflex Trainer

This guide walks you through setting up Firebase Firestore for the Quant Reflex Trainer PWA.

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

## Step 3: Create the Firestore Database

1. In the Firebase Console sidebar, click **Build → Firestore Database**.
2. Click **Create database**.
3. Choose a location closest to your users (e.g., `asia-south1` for India).
4. Select **Start in test mode** for development (you can tighten rules later).
5. Click **Enable**.

---

## Step 4: Set Up Firestore Security Rules

For production, update the Firestore rules to restrict access. Go to **Firestore Database → Rules** and set:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Allow each device to read/write only its own document
    match /users/{deviceId} {
      allow read, write: if true;
    }

    // Deny access to all other collections
    match /{document=**} {
      allow read, write: if false;
    }
  }
}
```

> **Note:** Since this app uses device-based IDs (no authentication), the rules above allow any client to read/write user documents. For stronger security, consider adding Firebase Authentication in the future and restricting access with `request.auth.uid`.

---

## Step 5: Enable Offline Persistence

Offline persistence is already enabled in the app code (`js/firebase.js`). Firestore will automatically:

- Cache data locally for offline access
- Queue writes made while offline
- Sync data when the connection is restored

No additional setup is needed.

---

## Step 6: Verify the Setup

1. Open the app in a browser.
2. Open the browser Developer Tools → Console.
3. You should see no Firebase errors.
4. Go to the Firebase Console → Firestore Database → Data.
5. After using the app, you should see a document under the `users` collection with your device ID.

---

## Firestore Database Structure

```
users/
  └── {deviceId}/
        ├── settings        (dark mode, sound, vibration, difficulty, dailyGoal)
        ├── stats           (progress data: totalAttempted, totalCorrect, streaks, etc.)
        ├── quickLinks      (array of selected quick link IDs)
        ├── customTopics    (array of user-created topic objects)
        ├── customFormulas  (object mapping topicId → array of formula objects)
        └── bookmarks       (array of bookmarked formula IDs)
```

---

## How Device-Based Identity Works

- On first app launch, a unique device ID is generated using `crypto.randomUUID()`.
- The ID is stored in `localStorage` as `deviceId` (e.g., `device_a8f3b29c-1d4e-4abc-9def-1234567890ab`).
- This ID acts as the Firestore document key under the `users` collection.
- No login or authentication is required.
- Each installation gets its own profile automatically.
- If you share the same `deviceId` across devices, data will sync.

---

## Troubleshooting

| Issue | Solution |
|---|---|
| Firebase not initializing | Check that the Firebase SDK scripts load before `firebase.js` in `index.html` |
| Console says "Firebase not configured" | Verify `firebaseConfig` values in `js/firebase.js` |
| Firestore writes failing | Check Firestore rules in the Firebase Console |
| Offline mode not working | Ensure only one tab is open (multi-tab persistence requires `synchronizeTabs: true`, which is already enabled) |
| Data not syncing | Check network connectivity and Firestore Console for the user document |

---

## Firebase SDK Version

The app uses Firebase JavaScript SDK **v10.12.2** (compat build) loaded via CDN:

```html
<script src="https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js"></script>
<script src="https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore-compat.js"></script>
```

The compat build is used for maximum browser compatibility with the vanilla JavaScript architecture.
