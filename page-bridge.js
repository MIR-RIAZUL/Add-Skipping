/**
 * AdFast — Page Bridge (MAIN World Execution Engine)
 * ==================================================
 * Runs in the MAIN world at document_start.
 *
 * Implements 3 Seamless Layers:
 *  - Layer 1 (Preventive): Intercepts ytInitialPlayerResponse and fetch('/youtubei/v1/player')
 *                          to strip ad placements before YouTube's player ever schedules them.
 *                          The main video starts directly from second 0 with 0 ads and 0 buffering.
 *  - Layer 2 (Native API & Touch): Direct MAIN-world access to movie_player.skipAd(),
 *                                  finishAd(), and TouchEvent bypass for isTrusted.
 *  - Layer 3 (Ultra-Fast Finisher): If an ad slips through, immediately forces 16x speed,
 *                                   mutes, seeks to end, clicks skip, and restores video.
 */

(() => {
  'use strict';

  // =========================================================================
  // LAYER 1: Strip Ad Data from YouTube Player Responses (Preventive)
  // =========================================================================

  const AD_PROPERTIES = [
    'adPlacements',
    'playerAds',
    'adSlots',
    'adBreakHeartbeatParams',
    'adBreakParams',
    'adTagUrl',
    'adParams',
    'adConfig',
    'ads'
  ];

  function sanitizeAdData(obj) {
    if (!obj || typeof obj !== 'object') return;

    if (Array.isArray(obj)) {
      for (let i = 0; i < obj.length; i++) {
        sanitizeAdData(obj[i]);
      }
      return;
    }

    for (const prop of AD_PROPERTIES) {
      if (prop in obj) {
        delete obj[prop];
      }
    }

    // Check nested playerResponse containers
    if (obj.playerResponse && typeof obj.playerResponse === 'object') {
      sanitizeAdData(obj.playerResponse);
    }
  }

  // Intercept Response.prototype.json (catches SPA navigation player requests)
  const originalResponseJson = Response.prototype.json;
  Response.prototype.json = async function (...args) {
    const data = await originalResponseJson.apply(this, args);
    try {
      if (!document.documentElement.classList.contains('adfast-disabled') && data && typeof data === 'object') {
        sanitizeAdData(data);
      }
    } catch (e) {}
    return data;
  };

  // Intercept ytInitialPlayerResponse (catches initial page load video response)
  let _ytInitialPlayerResponse = window.ytInitialPlayerResponse;
  if (_ytInitialPlayerResponse) {
    sanitizeAdData(_ytInitialPlayerResponse);
  }

  try {
    Object.defineProperty(window, 'ytInitialPlayerResponse', {
      get() {
        return _ytInitialPlayerResponse;
      },
      set(val) {
        if (!document.documentElement.classList.contains('adfast-disabled')) {
          if (val && typeof val === 'object') {
            try {
              sanitizeAdData(val);
            } catch (e) {}
          }
        }
        _ytInitialPlayerResponse = val;
      },
      configurable: true,
      enumerable: true
    });
  } catch (e) {}


  // =========================================================================
  // LAYER 2 & 3: MAIN-World Instant Player Controller
  // =========================================================================

  let isCurrentlyInAd = false;
  let savedPlaybackRate = 1;
  let adFastInterval = null;

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

  function triggerSkipButtons() {
    for (const selector of SKIP_SELECTORS) {
      const btn = document.querySelector(selector);
      if (btn) {
        // 1. Synthetic TouchEvents bypass desktop MouseEvent.isTrusted checks
        try {
          if (typeof Touch === 'function' && typeof TouchEvent === 'function') {
            const touch = new Touch({
              identifier: Date.now(),
              target: btn,
              clientX: 10,
              clientY: 10,
              radiusX: 2.5,
              radiusY: 2.5,
              rotationAngle: 10,
              force: 0.5
            });
            btn.dispatchEvent(new TouchEvent('touchstart', {
              bubbles: true,
              cancelable: true,
              touches: [touch],
              targetTouches: [touch],
              changedTouches: [touch]
            }));
            btn.dispatchEvent(new TouchEvent('touchend', {
              bubbles: true,
              cancelable: true,
              touches: [],
              targetTouches: [],
              changedTouches: [touch]
            }));
          }
        } catch (e) {}

        // 2. Pointer & Mouse fallbacks
        try {
          btn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
          btn.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true }));
          btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
          btn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
          if (typeof btn.click === 'function') {
            btn.click();
          }
        } catch (e) {}
      }
    }
  }

  function handleInstantAdBypass() {
    if (document.documentElement.classList.contains('adfast-disabled')) {
      return;
    }

    const player = document.getElementById('movie_player') || document.querySelector('.html5-video-player');
    const isAd = player && (
      player.classList.contains('ad-showing') ||
      player.classList.contains('ad-interrupting')
    );

    const video = document.querySelector('video.html5-main-video') || (player ? player.querySelector('video') : null);

    if (isAd && video) {
      if (!isCurrentlyInAd) {
        isCurrentlyInAd = true;
        if (video.playbackRate > 0 && video.playbackRate <= 4) {
          savedPlaybackRate = video.playbackRate;
        }
        window.dispatchEvent(new CustomEvent('adfast:ad-skipped'));
        startFastPolling();
      }

      // 1. Mute audio during ad
      video.muted = true;

      // 2. Maximum playback speed
      video.playbackRate = 16;

      // 3. Fast-forward to ad end
      if (isFinite(video.duration) && video.duration > 0) {
        if (video.currentTime < video.duration) {
          video.currentTime = video.duration;
        }
      }

      // 4. Ensure playback isn't stalled
      if (video.paused) {
        video.play().catch(() => {});
      }

      // 5. Invoke native YouTube player skip methods directly in MAIN world
      if (typeof player.skipAd === 'function') {
        try { player.skipAd(); } catch (e) {}
      }
      if (typeof player.finishAd === 'function') {
        try { player.finishAd(); } catch (e) {}
      }

      // 6. Trigger skip buttons
      triggerSkipButtons();

    } else if (!isAd && isCurrentlyInAd) {
      // Ad finished — restore normal playback
      isCurrentlyInAd = false;
      stopFastPolling();
      if (video) {
        video.playbackRate = (savedPlaybackRate >= 0.25 && savedPlaybackRate <= 4) ? savedPlaybackRate : 1;
        video.muted = false;
        if (video.paused) {
          video.play().catch(() => {});
        }
      }
    }
  }

  function startFastPolling() {
    if (adFastInterval) return;
    adFastInterval = setInterval(handleInstantAdBypass, 40);
  }

  function stopFastPolling() {
    if (adFastInterval) {
      clearInterval(adFastInterval);
      adFastInterval = null;
    }
  }

  // Listen for signal from content.js
  window.addEventListener('adfast:skip-ad', handleInstantAdBypass);

  // Scoped observer on movie_player for instantaneous ad detection
  let playerObserver = null;
  function attachBridgeObserver() {
    const player = document.getElementById('movie_player');
    if (player && !playerObserver) {
      playerObserver = new MutationObserver(handleInstantAdBypass);
      playerObserver.observe(player, {
        attributes: true,
        attributeFilter: ['class']
      });
      return true;
    }
    return false;
  }

  // Bootstrap observer
  if (!attachBridgeObserver()) {
    const waitTimer = setInterval(() => {
      if (attachBridgeObserver()) {
        clearInterval(waitTimer);
      }
    }, 100);
  }

  // Handle SPA transitions
  window.addEventListener('yt-navigate-finish', () => {
    isCurrentlyInAd = false;
    stopFastPolling();
    setTimeout(attachBridgeObserver, 150);
  });
})();
