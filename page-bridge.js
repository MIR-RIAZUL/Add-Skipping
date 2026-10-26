/**
 * AdFast — Page Bridge (MAIN World Execution Engine)
 * ==================================================
 * Executes directly inside the page's MAIN JavaScript context at document_start.
 * Directly controls #movie_player using YouTube's internal player API.
 *
 * Designed for 0% idle CPU and zero thread blocking:
 * - NO heavy JSON recursion (prevents Page Unresponsive freeze)
 * - NO dangerous global property overrides
 * - Targeted class-only observer on #movie_player
 * - Native player.skipAd() + player.finishAd() for instant 0ms ad dismissal
 */

(() => {
  'use strict';

  let savedPlaybackRate = 1;
  let isAdActive = false;
  let adSkipTimer = null;

  const SKIP_SELECTORS = [
    '.ytp-skip-ad-button',
    '.ytp-ad-skip-button',
    '.ytp-ad-skip-button-modern',
    '.ytp-ad-skip-button-slot button',
    '.ytp-ad-player-overlay-layout__skip-or-preview-container button',
    '[id^="skip-button"] button',
    '.ytp-ad-overlay-close-button',
    '.ytp-ad-text.ytp-ad-skip-button-text',
    '.ytp-ad-skip-button-container button',
    'button.ytp-ad-skip-button',
    '.ytp-ad-overlay-close-container button'
  ];

  /**
   * Dismiss the currently active in-stream ad
   */
  function dismissAd(player, video) {
    if (!player) player = document.getElementById('movie_player');
    if (!player) return;

    const inAd =
      player.classList.contains('ad-showing') ||
      player.classList.contains('ad-interrupting');

    if (!inAd) {
      if (isAdActive) {
        // Ad has completed — restore normal content playback
        isAdActive = false;
        if (adSkipTimer) {
          clearInterval(adSkipTimer);
          adSkipTimer = null;
        }
        if (!video) {
          video =
            document.querySelector('video.html5-main-video') ||
            player.querySelector('video');
        }
        if (video) {
          video.playbackRate =
            savedPlaybackRate >= 0.25 && savedPlaybackRate <= 4
              ? savedPlaybackRate
              : 1;
          video.muted = false;
          if (video.paused) {
            video.play().catch(() => {});
          }
        }
      }
      return;
    }

    // Active in-stream ad detected
    if (!video) {
      video =
        document.querySelector('video.html5-main-video') ||
        player.querySelector('video');
    }

    if (!isAdActive) {
      isAdActive = true;
      if (video && video.playbackRate > 0 && video.playbackRate <= 4) {
        savedPlaybackRate = video.playbackRate;
      }
      window.dispatchEvent(new CustomEvent('adfast:ad-skipped'));
    }

    // 1. Mute and fast-forward to the very end
    if (video) {
      video.muted = true;
      video.playbackRate = 16;
      if (isFinite(video.duration) && video.duration > 0) {
        video.currentTime = video.duration;
      }
      if (video.paused) {
        video.play().catch(() => {});
      }
    }

    // 2. Call YouTube's native player API methods
    try {
      if (typeof player.skipAd === 'function') {
        player.skipAd();
      }
    } catch (e) {}

    try {
      if (typeof player.finishAd === 'function') {
        player.finishAd();
      }
    } catch (e) {}

    // 3. Click any visible skip button in DOM
    for (const selector of SKIP_SELECTORS) {
      const btn = document.querySelector(selector);
      if (btn) {
        try {
          btn.click();
        } catch (e) {}
        break; // clicked the primary button
      }
    }
  }

  /**
   * Responds to changes in player state
   */
  function onPlayerStateChange() {
    if (document.documentElement.classList.contains('adfast-disabled')) {
      return;
    }

    const player = document.getElementById('movie_player');
    if (!player) return;

    const inAd =
      player.classList.contains('ad-showing') ||
      player.classList.contains('ad-interrupting');

    if (inAd) {
      const video =
        document.querySelector('video.html5-main-video') ||
        player.querySelector('video');
      dismissAd(player, video);

      // Temporary 100ms interval ONLY while an ad is running (e.g. multi-part ads 1 of 2 -> 2 of 2)
      if (!adSkipTimer) {
        adSkipTimer = setInterval(() => {
          if (
            !player.classList.contains('ad-showing') &&
            !player.classList.contains('ad-interrupting')
          ) {
            dismissAd(player, null);
          } else {
            dismissAd(player, null);
          }
        }, 100);
      }
    } else if (isAdActive) {
      dismissAd(player, null);
    }
  }

  // Targeted class-only observer on #movie_player (0% CPU when not in ad)
  let observer = null;
  function initObserver() {
    const player = document.getElementById('movie_player');
    if (player && !observer) {
      observer = new MutationObserver(onPlayerStateChange);
      observer.observe(player, {
        attributes: true,
        attributeFilter: ['class']
      });
      onPlayerStateChange();
      return true;
    }
    return false;
  }

  if (!initObserver()) {
    const poll = setInterval(() => {
      if (initObserver()) {
        clearInterval(poll);
      }
    }, 200);
  }

  // YouTube SPA dynamic navigation
  window.addEventListener('yt-navigate-finish', () => {
    isAdActive = false;
    if (adSkipTimer) {
      clearInterval(adSkipTimer);
      adSkipTimer = null;
    }
    initObserver();
  });

  // Listen for signal from content.js
  window.addEventListener('adfast:skip-ad', () => {
    onPlayerStateChange();
  });
})();
