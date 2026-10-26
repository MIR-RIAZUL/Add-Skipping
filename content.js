/**
 * AdFast - High-speed YouTube Ad Controller & DOM Observer
 * Bypasses video ads instantaneously using player manipulation
 * without triggering anti-adblock detection.
 */

(() => {
  'use strict';

  // State variables
  let isEnabled = true;
  let hideShorts = false;
  let isCurrentlyInAd = false;
  let savedPlaybackRate = 1;
  let scriptMutedVideo = false;
  let lastAdCountedTime = 0;
  const AD_COUNT_DEBOUNCE_MS = 1500;

  // Selectors for skip and close buttons across various YouTube player versions
  const SKIP_BUTTON_SELECTORS = [
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
   * Synchronize configuration with chrome.storage.local
   */
  async function initConfig() {
    try {
      const data = await chrome.storage.local.get({
        enabled: true,
        hideShorts: false
      });
      isEnabled = data.enabled !== false;
      hideShorts = !!data.hideShorts;
      applyDocumentClasses();
    } catch (err) {
      // Storage access error or context invalidated
    }
  }

  /**
   * Reflect current settings on document root for pure CSS rules
   */
  function applyDocumentClasses() {
    const root = document.documentElement;
    if (!root) return;

    if (isEnabled) {
      root.classList.remove('adfast-disabled');
    } else {
      root.classList.add('adfast-disabled');
      // If disabled mid-playback, restore video
      if (isCurrentlyInAd) {
        restoreNormalPlayback();
      }
    }

    if (hideShorts) {
      root.classList.add('adfast-hide-shorts');
    } else {
      root.classList.remove('adfast-hide-shorts');
    }
  }

  /**
   * Listen for live changes from popup toggles
   */
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;

    if (changes.enabled) {
      isEnabled = changes.enabled.newValue !== false;
      applyDocumentClasses();
      if (isEnabled) {
        processAdCycle();
      }
    }

    if (changes.hideShorts) {
      hideShorts = !!changes.hideShorts.newValue;
      applyDocumentClasses();
    }
  });

  /**
   * Safely increment the ads bypassed counter in storage
   */
  async function incrementAdsSkipped() {
    try {
      const res = await chrome.storage.local.get({ adsSkippedCount: 0 });
      const current = res.adsSkippedCount || 0;
      await chrome.storage.local.set({ adsSkippedCount: current + 1 });
    } catch (e) {
      // Ignore storage error
    }
  }

  /**
   * Click any available skip or close buttons.
   * Uses three strategies for maximum reliability:
   *  1. Standard .click() (works when isTrusted is not checked)
   *  2. Synthetic TouchEvents (YouTube accepts mobile touch without isTrusted gate)
   *  3. Dispatches 'adfast:skip-ad' for page-bridge.js to call player.skipAd() in MAIN world
   */
  function clickSkipButtons() {
    for (const selector of SKIP_BUTTON_SELECTORS) {
      const elements = document.querySelectorAll(selector);
      for (const el of elements) {
        if (el && typeof el.click === 'function') {
          try {
            el.click();
          } catch (e) {
            // Ignore click error
          }
          // Dispatch synthetic touch events — YouTube's skip handler accepts
          // mobile touch events without blocking on MouseEvent.isTrusted
          try {
            el.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, cancelable: true }));
            el.dispatchEvent(new TouchEvent('touchend', { bubbles: true, cancelable: true }));
          } catch (e) {
            // TouchEvent may not exist in all environments (JSDOM/test runner)
          }
        }
      }
    }

    // Signal page-bridge.js (MAIN world) to invoke player.skipAd() / player.finishAd()
    try {
      window.dispatchEvent(new CustomEvent('adfast:skip-ad'));
    } catch (e) {
      // Ignore dispatch error
    }
  }

  /**
   * Restore video playback rate and mute state when ad finishes
   */
  function restoreNormalPlayback(videoElement) {
    isCurrentlyInAd = false;
    const video = videoElement || document.querySelector('video.html5-main-video') || document.querySelector('#movie_player video');
    if (!video) return;

    // Restore playback rate (fallback to 1 if anomalous)
    if (savedPlaybackRate && isFinite(savedPlaybackRate) && savedPlaybackRate >= 0.25 && savedPlaybackRate <= 4) {
      video.playbackRate = savedPlaybackRate;
    } else {
      video.playbackRate = 1;
    }

    // Restore audio if muted by script
    if (scriptMutedVideo) {
      video.muted = false;
      scriptMutedVideo = false;
    }

    // Resume video if paused
    if (video.paused && video.currentTime > 0) {
      video.play().catch(() => {});
    }
  }

  /**
   * Handle active video ad bypass.
   * Seeks to exact end (not duration - 0.05) and dispatches 'ended' event
   * so the ad completes fully without stalling on the end-card.
   * Calls clickSkipButtons() both before and after seeking for reliability.
   */
  function handleAdActive(video) {
    if (!video) return;

    // If starting a new ad
    if (!isCurrentlyInAd) {
      isCurrentlyInAd = true;

      // Capture normal rate if not in 16x speed
      if (video.playbackRate !== 16) {
        savedPlaybackRate = video.playbackRate || 1;
      }

      // Mute audio during ad
      if (!video.muted) {
        video.muted = true;
        scriptMutedVideo = true;
      }

      // Record skipped ad count with debounce
      const now = Date.now();
      if (now - lastAdCountedTime > AD_COUNT_DEBOUNCE_MS) {
        lastAdCountedTime = now;
        incrementAdsSkipped();
      }
    }

    // Force 16x playback speed
    if (video.playbackRate !== 16) {
      video.playbackRate = 16;
    }

    // Click skip buttons BEFORE seeking (catches already-visible skip buttons)
    clickSkipButtons();

    // Seek to the exact end of the ad so it completes fully (no end-card stall)
    if (isFinite(video.duration) && video.duration > 0) {
      if (video.currentTime < video.duration) {
        video.currentTime = video.duration;
      }
    }

    // Ensure playback isn't stalled; dispatch 'ended' to trigger ad completion
    if (video.paused) {
      video.play().catch(() => {});
    }
    try {
      video.dispatchEvent(new Event('ended'));
    } catch (e) {
      // Ignore dispatch error
    }

    // Click skip buttons AFTER seeking (catches skip buttons revealed by seek)
    clickSkipButtons();
  }

  /**
   * Detect and automatically dismiss anti-adblock enforcement dialogs
   */
  function dismissEnforcementModals() {
    const enforcementMsg = document.querySelector('ytd-enforcement-message-view-model');
    if (enforcementMsg) {
      const dialog = enforcementMsg.closest('tp-yt-paper-dialog') || enforcementMsg.closest('ytd-popup-container');
      if (dialog) {
        dialog.remove();
      }
      document.querySelectorAll('tp-yt-iron-overlay-backdrop').forEach(el => el.remove());
      document.documentElement.classList.add('adfast-backdrop-blocked');

      const video = document.querySelector('video.html5-main-video') || document.querySelector('video');
      if (video && video.paused) {
        video.play().catch(() => {});
      }
    }
  }

  /**
   * Primary inspection cycle: detects ads and controls video player
   */
  function processAdCycle() {
    if (!isEnabled) return;

    dismissEnforcementModals();

    const player = document.querySelector('#movie_player') || document.querySelector('.html5-video-player');
    const isAdShowing = player && (
      player.classList.contains('ad-showing') ||
      player.classList.contains('ad-interrupting')
    );

    const hasAdOverlay = !!document.querySelector('.ytp-ad-player-overlay, .ytp-ad-player-overlay-layout');
    const isAd = isAdShowing || hasAdOverlay;

    const video = document.querySelector('video.html5-main-video') || document.querySelector('#movie_player video');

    if (isAd && video) {
      handleAdActive(video);
    } else if (!isAd && isCurrentlyInAd) {
      restoreNormalPlayback(video);
    }
  }

  /**
   * Initialize DOM observer and adaptive periodic timer.
   * - Scopes MutationObserver to #movie_player (fix M3: avoids observing entire DOM)
   * - Uses adaptive interval: 50ms during active ads for instant multi-part ad clearing,
   *   falls back to idle-aware check otherwise (fix M2: reduces CPU overhead)
   */
  function startEngine() {
    initConfig();

    // Ensure classes are applied once DOM element is ready
    if (document.documentElement) {
      applyDocumentClasses();
    } else {
      document.addEventListener('DOMContentLoaded', applyDocumentClasses, { once: true });
    }

    // --- Scoped MutationObserver (M3 fix) ---
    // Observe #movie_player for class attribute changes (ad-showing / ad-interrupting)
    // and childList for overlay elements. Falls back to document-level observation
    // until #movie_player appears in the DOM.
    let playerObserver = null;

    function attachPlayerObserver() {
      const player = document.getElementById('movie_player');
      if (player && !playerObserver) {
        playerObserver = new MutationObserver(() => {
          processAdCycle();
        });
        playerObserver.observe(player, {
          attributes: true,
          attributeFilter: ['class'],
          childList: true,
          subtree: true
        });
      }
    }

    // Fallback document-level observer — only runs until #movie_player is found,
    // then switches to the scoped observer
    const bootstrapObserver = new MutationObserver(() => {
      processAdCycle();
      if (!playerObserver) {
        attachPlayerObserver();
        if (playerObserver) {
          bootstrapObserver.disconnect();
        }
      }
    });

    bootstrapObserver.observe(document, {
      childList: true,
      subtree: true
    });

    // Try to attach immediately if #movie_player already exists
    attachPlayerObserver();
    if (playerObserver) {
      bootstrapObserver.disconnect();
    }

    // --- Adaptive heartbeat timer (M2 fix) ---
    // 50ms during active ads for instantaneous multi-part ad clearing (1/2 → 2/2)
    // Skips execution when tab is hidden (document.hidden) to save CPU
    let adIntervalId = null;
    let idleIntervalId = null;

    function startAdFastInterval() {
      if (adIntervalId !== null) return;
      // Clear the idle interval while running fast
      if (idleIntervalId !== null) {
        clearInterval(idleIntervalId);
        idleIntervalId = null;
      }
      adIntervalId = setInterval(processAdCycle, 50);
    }

    function stopAdFastInterval() {
      if (adIntervalId !== null) {
        clearInterval(adIntervalId);
        adIntervalId = null;
      }
      // Restart idle-rate polling
      if (idleIntervalId === null) {
        idleIntervalId = setInterval(() => {
          if (document.hidden) return; // Skip when tab is in background
          processAdCycle();
          // If an ad starts, switch to fast interval
          if (isCurrentlyInAd) {
            startAdFastInterval();
          }
        }, 500);
      }
    }

    // Wrap processAdCycle to manage adaptive timing
    const _originalProcessAdCycle = processAdCycle;
    // Override is not needed — we monitor isCurrentlyInAd transitions instead

    // Start with idle-rate polling
    stopAdFastInterval();

    // Watch for ad state transitions to switch intervals
    let _prevAdState = false;
    setInterval(() => {
      if (isCurrentlyInAd && !_prevAdState) {
        startAdFastInterval();
      } else if (!isCurrentlyInAd && _prevAdState) {
        stopAdFastInterval();
      }
      _prevAdState = isCurrentlyInAd;
    }, 100);

    // YouTube SPA navigation events
    window.addEventListener('yt-navigate-finish', () => {
      isCurrentlyInAd = false;
      processAdCycle();
      // Re-attach observer if player was replaced during SPA navigation
      playerObserver = null;
      attachPlayerObserver();
    });

    window.addEventListener('yt-page-data-updated', processAdCycle);
  }

  // Start engine immediately
  startEngine();
})();
