/**
 * AdFast - Popup Controller Logic
 * Synchronizes options and live ad counters with chrome.storage.local
 */

document.addEventListener('DOMContentLoaded', async () => {
  const enableToggle = document.getElementById('enableToggle');
  const shortsToggle = document.getElementById('shortsToggle');
  const adsCountEl = document.getElementById('adsCount');
  const statusPill = document.getElementById('statusPill');
  const statusText = document.getElementById('statusText');
  const resetBtn = document.getElementById('resetBtn');
  const resetBtnText = document.getElementById('resetBtnText');

  /**
   * Update visual status pill
   */
  function updateStatusUI(isActive) {
    if (isActive) {
      statusPill.classList.add('active');
      statusPill.classList.remove('inactive');
      statusText.textContent = 'Active';
    } else {
      statusPill.classList.remove('active');
      statusPill.classList.add('inactive');
      statusText.textContent = 'Disabled';
    }
  }

  /**
   * Format numbers nicely with commas
   */
  function formatNumber(num) {
    return Number(num || 0).toLocaleString();
  }

  /**
   * Load stored settings and initialize UI
   */
  async function loadState() {
    try {
      const data = await chrome.storage.local.get({
        enabled: true,
        hideShorts: false,
        adsSkippedCount: 0
      });

      const isEnabled = data.enabled !== false;
      const isShortsHidden = !!data.hideShorts;
      const count = data.adsSkippedCount || 0;

      enableToggle.checked = isEnabled;
      shortsToggle.checked = isShortsHidden;
      adsCountEl.textContent = formatNumber(count);
      updateStatusUI(isEnabled);
    } catch (err) {
      console.error('AdFast: Error loading settings from storage:', err);
    }
  }

  // Handle Master Enable/Disable Toggle
  enableToggle.addEventListener('change', async () => {
    const isEnabled = enableToggle.checked;
    updateStatusUI(isEnabled);
    try {
      await chrome.storage.local.set({ enabled: isEnabled });
    } catch (err) {
      console.error('AdFast: Error saving enabled state:', err);
    }
  });

  // Handle YouTube Shorts Toggle
  shortsToggle.addEventListener('change', async () => {
    const isShortsHidden = shortsToggle.checked;
    try {
      await chrome.storage.local.set({ hideShorts: isShortsHidden });
    } catch (err) {
      console.error('AdFast: Error saving hideShorts state:', err);
    }
  });

  // Handle Reset Counter Button
  resetBtn.addEventListener('click', async () => {
    try {
      await chrome.storage.local.set({ adsSkippedCount: 0 });
      adsCountEl.textContent = '0';

      // Provide temporary visual feedback
      resetBtnText.textContent = 'Reset Complete!';
      resetBtn.style.color = '#38c853';
      resetBtn.style.borderColor = 'rgba(43, 166, 64, 0.4)';

      setTimeout(() => {
        resetBtnText.textContent = 'Reset stats';
        resetBtn.style.color = '';
        resetBtn.style.borderColor = '';
      }, 1200);
    } catch (err) {
      console.error('AdFast: Error resetting counter:', err);
    }
  });

  // Listen for live background changes in storage (e.g. ad count incremented by content.js)
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;

    if (changes.adsSkippedCount) {
      adsCountEl.textContent = formatNumber(changes.adsSkippedCount.newValue || 0);
    }

    if (changes.enabled) {
      const isEnabled = changes.enabled.newValue !== false;
      enableToggle.checked = isEnabled;
      updateStatusUI(isEnabled);
    }

    if (changes.hideShorts) {
      shortsToggle.checked = !!changes.hideShorts.newValue;
    }
  });

  // Initial load
  await loadState();
});
