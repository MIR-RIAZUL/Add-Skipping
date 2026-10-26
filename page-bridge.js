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

  window.addEventListener('adfast:skip-ad', () => {
    // Respect the disabled state — do nothing if the user turned off AdFast
    if (document.documentElement.classList.contains('adfast-disabled')) {
      return;
    }

    const player = document.getElementById('movie_player');
    if (!player) return;

    // Attempt YouTube's internal player API methods
    try {
      if (typeof player.skipAd === 'function') {
        player.skipAd();
      }
    } catch (e) {
      // Silently ignore — method may not exist on this player version
    }

    try {
      if (typeof player.finishAd === 'function') {
        player.finishAd();
      }
    } catch (e) {
      // Silently ignore
    }

    // If the ad is still showing after internal API calls, force-end it
    if (
      player.classList.contains('ad-showing') ||
      player.classList.contains('ad-interrupting')
    ) {
      const video =
        document.querySelector('video.html5-main-video') ||
        player.querySelector('video');
      if (video && isFinite(video.duration) && video.duration > 0) {
        video.currentTime = video.duration;
        video.dispatchEvent(new Event('ended'));
      }
    }
  });
})();
