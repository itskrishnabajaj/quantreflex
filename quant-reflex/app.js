/**
 * app.js — Shared application bootstrap
 *
 * Responsibilities:
 *   1. Register the service worker
 *   2. Handle the PWA install prompt
 *   3. Provide a loading animation until the page is ready
 */

/* ---- Service Worker Registration ---- */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('./service-worker.js')
      .catch((err) => console.warn('SW registration failed:', err));
  });
}

/* ---- PWA Install Prompt ---- */
let deferredPrompt = null;

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;

  /* Show an install button if one exists on the current page */
  const btn = document.getElementById('installBtn');
  if (btn) {
    btn.hidden = false;
    btn.addEventListener('click', () => {
      deferredPrompt.prompt();
      deferredPrompt.userChoice.then(() => { deferredPrompt = null; btn.hidden = true; });
    });
  }
});

/* ---- Page-ready animation ---- */
window.addEventListener('DOMContentLoaded', () => {
  document.body.classList.add('loaded');
});
