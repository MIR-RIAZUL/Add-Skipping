/**
 * AdFast — Page Bridge (MAIN World)
 * ===================================
 * Runs in the MAIN world so it has direct access to YouTube's internal
 * player API methods (skipAd, finishAd) which are invisible from the
 * ISOLATED content script world.
 *
 * Listens for a custom 'adfast:skip-ad' event dispatched by content.js
 * and invokes YouTube's native skip/finish methods to reliably clear ads.
 */

(() => {
  'use strict';

  let lastSkipTime = 0;
  const SKIP_DEBOUNCE_MS = 150;

  window.addEventListener('adfast:skip-ad', () => {
    // Respect the disabled state — do nothing if the user turned off AdFast
    if (document.documentElement.classList.contains('adfast-disabled')) {
      return;
    }

    // Debounce to prevent event storming and CPU exhaustion
    const now = Date.now();
    if (now - lastSkipTime < SKIP_DEBOUNCE_MS) {
      return;
    }
    lastSkipTime = now;

    const player = document.getElementById('movie_player');
    if (!player) return;

    // STRICT SAFETY CHECK: Only proceed if an in-stream ad is actively showing
    const isAd =
      player.classList.contains('ad-showing') ||
      player.classList.contains('ad-interrupting');
    if (!isAd) return;

    // 1. Attempt YouTube's native player API methods
    try {
      if (typeof player.skipAd === 'function') {
        player.skipAd();
        return;
      }
    } catch (e) {
      // Silently ignore — method may not exist on this player version
    }

    try {
      if (typeof player.finishAd === 'function') {
        player.finishAd();
        return;
      }
    } catch (e) {
      // Silently ignore
    }

    // 2. Safe fallback: fast-forward the ad video element
    // NOTE: NEVER dispatch a synthetic 'ended' event — it corrupts YouTube's
    // internal MediaSource buffer state machine and locks up the player!
    const video =
      document.querySelector('video.html5-main-video') ||
      player.querySelector('video');
    if (video && isFinite(video.duration) && video.duration > 0) {
      if (video.currentTime < video.duration) {
        video.currentTime = video.duration;
      }
      if (video.paused) {
        video.play().catch(() => {});
      }
    }
  });
})();
