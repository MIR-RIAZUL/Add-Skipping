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
    '.ytp-ad-skip-button',
    '.ytp-skip-ad-button',
    '.ytp-ad-overlay-close-button',
    '.ytp-ad-text.ytp-ad-skip-button-text'
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
   * Dispatch comprehensive touch, pointer, and click events with real coordinates
   */
  function triggerSkipClick(button) {
    if (!button) return;

    try {
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
        clientX: clientX,
        clientY: clientY,
        screenX: clientX,
        screenY: clientY
      };

      // 1. Synthetic TouchEvents bypass desktop MouseEvent.isTrusted checks
      if (typeof Touch === 'function' && typeof TouchEvent === 'function') {
        try {
          const touch = new Touch({
            identifier: Date.now(),
            target: button,
            clientX: clientX,
            clientY: clientY,
            screenX: clientX,
            screenY: clientY,
            radiusX: 2.5,
            radiusY: 2.5,
            rotationAngle: 10,
            force: 0.5
          });
          button.dispatchEvent(
            new TouchEvent('touchstart', {
              bubbles: true,
              cancelable: true,
              touches: [touch],
              targetTouches: [touch],
              changedTouches: [touch]
            })
          );
          button.dispatchEvent(
            new TouchEvent('touchend', {
              bubbles: true,
              cancelable: true,
              touches: [],
              targetTouches: [],
              changedTouches: [touch]
            })
          );
        } catch (te) {}
      }

      // 2. PointerEvents
      if (typeof PointerEvent === 'function') {
        try {
          button.dispatchEvent(new PointerEvent('pointerdown', eventOptions));
          button.dispatchEvent(new PointerEvent('pointerup', eventOptions));
        } catch (pe) {}
      }

      // 3. MouseEvents
      if (typeof MouseEvent === 'function') {
        try {
          button.dispatchEvent(new MouseEvent('mousedown', eventOptions));
          button.dispatchEvent(new MouseEvent('mouseup', eventOptions));
          button.dispatchEvent(new MouseEvent('click', eventOptions));
        } catch (me) {}
      }

      // 4. Standard DOM click
      if (typeof button.click === 'function') {
        button.click();
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

    // 1. Mute and fast-forward to ad end
    if (video) {
      video.muted = true;
      video.playbackRate = 16;
      if (isFinite(video.duration) && video.duration > 0) {
        if (video.currentTime < video.duration) {
          video.currentTime = video.duration;
        }
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

    // 3. Find and auto-click any visible skip button in the DOM
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
