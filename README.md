# AdFast - Instant YouTube Ad Skipper (Chrome Extension)

A lightweight, production-grade Manifest V3 Chrome Extension that instantaneously bypasses YouTube video ads and removes banner ads without triggering YouTube's anti-adblock detection.

---

## Features

- **Instant Video Ad Acceleration**: Instead of blocking ad network requests (which triggers YouTube's enforcement screens), AdFast leverages player manipulation (mutes audio, sets playback rate to 16x, fast-forwards to the end, and clicks skip buttons instantly).
- **Zero Anti-Adblock Triggers**: Safely bypasses ads while auto-dismissing enforcement dialogs and restoring normal playback.
- **Cosmetic Banner & Feed Ad Removal**: Injects pure CSS to hide banners, promoted videos, search ads, and masthead ads cleanly with zero latency.
- **Customizable YouTube Shorts Filtering**: Dedicated toggle to hide YouTube Shorts shelves from the homepage and search feeds.
- **Modern Dark-Mode Dashboard**: Sleek 300px YouTube-themed toolbar popup with real-time stats, live sync via `chrome.storage.local`, and a reset counter.

---

## Project Structure

```text
Add-Skipping/
├── manifest.json       # Manifest V3 extension configuration
├── content.js          # High-speed DOM observer & video ad controller
├── styles.css          # Cosmetic filtering for homepage, feed, & sidebar ads
├── popup.html          # Toolbar popup UI
├── popup.css           # Modern YouTube dark-mode styling
├── popup.js            # Toggle controllers & live counter logic
└── icons/              # Valid standalone PNG icons
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

---

## How to Install in Google Chrome

1. Open **Google Chrome** and navigate to `chrome://extensions/`.
2. Toggle on **"Developer mode"** in the top-right corner.
3. Click the **"Load unpacked"** button in the top-left corner.
4. Select this directory:
   ```
   d:\antigravity_project\chrome extension\Add-Skipping
   ```
5. Pin **AdFast** to your Chrome toolbar.
6. Open any video on [youtube.com](https://www.youtube.com) to experience seamless ad-free playback!
