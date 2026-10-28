/**
 * AdFast — Page Bridge (MAIN World Execution Engine)
 * ==================================================
 * Executes directly inside the page's MAIN JavaScript context at document_start.
 * Directly controls #movie_player using YouTube's internal player API.
 *
 * Automatically detects and clicks skip buttons using Touch/Pointer/Mouse events
 * and calls native player.skipAd() so the user never has to click manually.
 */

(() => {
  'use strict';

  let savedPlaybackRate = 1;
  let isAdActive = false;
  let adSkipTimer = null;

  // Modern YouTube skip button selectors (most specific button selectors first)
  const SKIP_SELECTORS = [
    'button.ytp-ad-skip-button-modern',
    '.ytp-ad-skip-button-modern',
    '.ytp-ad-skip-button-slot button',
    '.ytp-ad-player-overlay-layout__skip-or-preview-container button',
    '[id^="skip-button"] button',
    'button.ytp-skip-ad-button',
    'button.ytp-ad-skip-button',
    '.ytp-skip-ad-button',
    '.ytp-ad-skip-button',
    '.ytp-ad-skip-button-container button',
    '.ytp-ad-overlay-close-button',
    '.ytp-ad-text.ytp-ad-skip-button-text',
    '.ytp-ad-overlay-close-container button'
  ];

  /**
   * Find the actual clickable button element (resolves container/text to button)
   */
  function findSkipButton() {
    for (const selector of SKIP_SELECTORS) {
      const el = document.querySelector(selector);
      if (el) {
        const clickable =
          (typeof el.closest === 'function'
            ? el.closest('button, [role="button"]')
            : null) || el;
        return clickable;
      }
    }
    return null;
  }

  /**
   * Dispatch clean DOM synthetic click on the button element directly
   * ONLY when #movie_player is actively displaying an ad.
   * Note: content.js handles debounced trusted CDP clicks.
   */
  function triggerSkipClick(button) {
    if (!button) return;

    const player = document.getElementById('movie_player');
    const inAd =
      player &&
      (player.classList.contains('ad-showing') ||
       player.classList.contains('ad-interrupting'));

    if (!inAd) return;

    try {
      // 1. Direct synthetic DOM click is safe and cannot hit the scrub bar beneath it
      if (typeof button.click === 'function') {
        button.click();
      }

      const rect = button.getBoundingClientRect();
      const clientX = Math.round(
        rect.left + (rect.width > 0 ? rect.width / 2 : 12)
      );
      const clientY = Math.round(
        rect.top + (rect.height > 0 ? rect.height / 2 : 12)
      );

      const eventOptions = {
        bubbles: true,
        cancelable: true,
        view: window,
        clientX,
        clientY
      };

      // 2. PointerEvents directly on the button element
      if (typeof PointerEvent === 'function') {
        try {
          button.dispatchEvent(new PointerEvent('pointerdown', eventOptions));
          button.dispatchEvent(new PointerEvent('pointerup', eventOptions));
        } catch (pe) {}
      }

      // 3. MouseEvents directly on the button element
      if (typeof MouseEvent === 'function') {
        try {
          button.dispatchEvent(new MouseEvent('mousedown', eventOptions));
          button.dispatchEvent(new MouseEvent('mouseup', eventOptions));
          button.dispatchEvent(new MouseEvent('click', eventOptions));
        } catch (me) {}
      }

      // 4. TouchEvents directly on the button element
      if (typeof Touch === 'function' && typeof TouchEvent === 'function') {
        try {
          button.dispatchEvent(
            new TouchEvent('touchstart', { bubbles: true, cancelable: true })
          );
          button.dispatchEvent(
            new TouchEvent('touchend', { bubbles: true, cancelable: true })
          );
        } catch (te) {}
      }
    } catch (e) {}
  }

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
        // Ad has completed — restore normal content playback immediately
        isAdActive = false;
        stopAdPolling();

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
      startAdPolling();
    }

    // 1. Mute and fast-forward ad at 16x speed
    // CRITICAL FIX: DO NOT set video.currentTime = video.duration on skippable ads!
    // Seeking to duration triggers YouTube's post-ad end-card freeze where playback
    // halts waiting for a click. 16x speed fast-forwards through countdowns (~300ms)
    // and triggerSkipClick dispatches a genuine CDP trusted click via background.js.
    if (video) {
      video.muted = true;
      video.playbackRate = 16;
      if (video.paused) {
        video.play().catch(() => {});
      }
    }

    // 2. Try legacy player API methods if present
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

    // 3. Find and auto-click any visible skip button in the DOM with trusted CDP click
    const skipBtn = findSkipButton();
    if (skipBtn) {
      triggerSkipClick(skipBtn);
    }
  }

  function startAdPolling() {
    if (adSkipTimer) return;
    adSkipTimer = setInterval(() => {
      const player = document.getElementById('movie_player');
      if (!player) return;

      const inAd =
        player.classList.contains('ad-showing') ||
        player.classList.contains('ad-interrupting');

      if (!inAd) {
        dismissAd(player, null);
      } else {
        dismissAd(player, null);
      }
    }, 50);
  }

  function stopAdPolling() {
    if (adSkipTimer) {
      clearInterval(adSkipTimer);
      adSkipTimer = null;
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
      startAdPolling();
    } else if (isAdActive) {
      dismissAd(player, null);
    }
  }

  // Targeted class-only observer on #movie_player
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
    stopAdPolling();
    initObserver();
  });

  // Listen for signal from content.js
  window.addEventListener('adfast:skip-ad', () => {
    onPlayerStateChange();
  });
})();
