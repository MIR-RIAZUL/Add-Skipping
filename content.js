/**
 * AdFast - High-speed YouTube Ad Controller & DOM Observer
 * Bypasses video ads instantaneously using player manipulation
 * without triggering anti-adblock detection or freezing the page.
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

  // Debounce for skip button triggers to prevent event storming
  let lastSkipTime = 0;
  const SKIP_DEBOUNCE_MS = 150;

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
   * Click any available skip or close buttons with debouncing
   */
  function clickSkipButtons() {
    const now = Date.now();
    if (now - lastSkipTime < SKIP_DEBOUNCE_MS) {
      return;
    }
    lastSkipTime = now;

    for (const selector of SKIP_BUTTON_SELECTORS) {
      const elements = document.querySelectorAll(selector);
      for (const el of elements) {
        if (el && typeof el.click === 'function') {
          try {
            el.click();
          } catch (e) {
            // Ignore click error
          }
          try {
            el.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, cancelable: true }));
            el.dispatchEvent(new TouchEvent('touchend', { bubbles: true, cancelable: true }));
          } catch (e) {
            // TouchEvent may not exist in all environments
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
   * Check if YouTube's player is actively playing an in-stream ad.
   * STRICT: Only the player element classes 'ad-showing' or 'ad-interrupting'
   * are valid indicators. Residual overlay elements in the DOM are ignored
   * to protect the main content video.
   */
  function isPlayerShowingAd() {
    const player = document.getElementById('movie_player') || document.querySelector('.html5-video-player');
    if (!player) return false;
    return player.classList.contains('ad-showing') || player.classList.contains('ad-interrupting');
  }

  /**
   * Handle active video ad bypass safely without corrupting video playback
   */
  function handleAdActive(video) {
    if (!video) return;

    // Strict safety check: Never manipulate the video unless confirmed in-stream ad
    if (!isPlayerShowingAd()) return;

    // If starting a new ad
    if (!isCurrentlyInAd) {
      isCurrentlyInAd = true;

      // Capture normal rate if not in 16x speed
      if (video.playbackRate > 0 && video.playbackRate <= 4) {
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

    // Ensure muted
    if (!video.muted) {
      video.muted = true;
      scriptMutedVideo = true;
    }

    // Force 16x playback speed
    if (video.playbackRate !== 16) {
      video.playbackRate = 16;
    }

    // Seek to the end of the ad to trigger natural completion
    if (isFinite(video.duration) && video.duration > 0) {
      if (video.currentTime < video.duration) {
        video.currentTime = video.duration;
      }
    }

    // Ensure playback isn't stalled (NOTE: Never dispatchEvent('ended') - corrupts MSE pipeline)
    if (video.paused) {
      video.play().catch(() => {});
    }

    // Click skip buttons (debounced to avoid event storming)
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

    const isAd = isPlayerShowingAd();
    const video = document.querySelector('video.html5-main-video') || document.querySelector('#movie_player video');

    if (isAd && video) {
      handleAdActive(video);
    } else if (!isAd && isCurrentlyInAd) {
      restoreNormalPlayback(video);
    }
  }

  /**
   * Throttled cycle runner using requestAnimationFrame to ensure
   * the main thread is never blocked and the page stays 100% responsive
   */
  let isThrottled = false;
  function throttledProcessAdCycle() {
    if (isThrottled) return;
    isThrottled = true;
    window.requestAnimationFrame(() => {
      isThrottled = false;
      processAdCycle();
    });
  }

  /**
   * Initialize DOM observer and periodic heartbeat timer
   */
  function startEngine() {
    initConfig();

    // Ensure classes are applied once DOM element is ready
    if (document.documentElement) {
      applyDocumentClasses();
    } else {
      document.addEventListener('DOMContentLoaded', applyDocumentClasses, { once: true });
    }

    // Scoped MutationObserver: Watches ONLY class attribute changes on #movie_player
    // (ad-showing / ad-interrupting), NOT childList/subtree, which prevents infinite loops
    let playerObserver = null;

    function attachPlayerObserver() {
      const player = document.getElementById('movie_player');
      if (player && !playerObserver) {
        playerObserver = new MutationObserver(throttledProcessAdCycle);
        playerObserver.observe(player, {
          attributes: true,
          attributeFilter: ['class']
        });
      }
    }

    // Lightweight bootstrap observer that only runs until #movie_player appears
    const bootstrapObserver = new MutationObserver(() => {
      throttledProcessAdCycle();
      if (!playerObserver) {
        attachPlayerObserver();
        if (playerObserver) {
          bootstrapObserver.disconnect();
        }
      }
    });

    bootstrapObserver.observe(document.documentElement || document, {
      childList: true,
      subtree: true
    });

    // Try attaching immediately
    attachPlayerObserver();
    if (playerObserver) {
      bootstrapObserver.disconnect();
    }

    // Lightweight 100ms periodic heartbeat (low CPU, skips when tab hidden unless in ad)
    setInterval(() => {
      if (document.hidden && !isCurrentlyInAd) return;
      processAdCycle();
    }, 100);

    // YouTube SPA navigation events
    window.addEventListener('yt-navigate-finish', () => {
      isCurrentlyInAd = false;
      processAdCycle();
      if (playerObserver) {
        playerObserver.disconnect();
        playerObserver = null;
      }
      attachPlayerObserver();
    });

    window.addEventListener('yt-page-data-updated', processAdCycle);
  }

  // Start engine immediately
  startEngine();
})();
