# ⚡ Thunder Download Manager - Browser Extension

<p align="center">
  <a href="https://addons.mozilla.org/en-US/firefox/addon/thunder-download-manager/">
    <img src="https://img.shields.io/badge/Mozilla_Firefox-Get_Extension-FF7139?style=for-the-badge&logo=firefox-browser&logoColor=white" alt="Firefox Add-on" />
  </a>
  <img src="https://img.shields.io/badge/Manifest-V3-4285F4?style=for-the-badge&logo=googlechrome&logoColor=white" alt="Manifest V3" />
  <img src="https://img.shields.io/badge/Platform-Chrome%20%7C%20Firefox%20%7C%20Edge%20%7C%20Brave-555555?style=for-the-badge" alt="Platforms" />
</p>

Official companion browser extension for **Thunder Download Manager (ThunderDM)**. Built with **Manifest V3**, this extension seamlessly connects your web browser with the ThunderDM desktop client, enabling automatic multi-threaded download interception, intelligent video sniffing, and direct media downloading.

---

## 📋 Table of Contents

- [Key Features](#-key-features)
- [Architecture & How It Works](#-architecture--how-it-works)
- [Building the Extension](#-building-the-extension)
- [Installation Guide](#-installation-guide)
  - [Chromium-Based Browsers](#1-chromium-based-browsers-chrome-edge-brave-opera-vivaldi-arc)
  - [Mozilla Firefox & Gecko Forks](#2-mozilla-firefox--gecko-forks-firefox-developer-edition-zen-librewolf-etc)
- [Extension Popup & Settings](#-extension-popup--settings)
- [Desktop Integration Protocol](#-desktop-integration-protocol)
- [Troubleshooting & FAQ](#-troubleshooting--faq)

---

## ✨ Key Features

### ⚡ Automatic Download Interception
- **Native Browser Download Interception:** Hooks into the browser download manager (`chrome.downloads` API) to detect file downloads, cancel the browser's slow single-threaded download dialog, and dispatch the download job directly to ThunderDM.
- **Smart Link Interception:** Automatically identifies clicks on downloadable file links matching dozens of media, archive, document, and executable extensions (`.mp4`, `.mkv`, `.zip`, `.rar`, `.7z`, `.iso`, `.exe`, `.msi`, `.dmg`, `.deb`, `.pdf`, `.torrent`, etc.) as well as links with `download` attributes.

### 🎬 Intelligent Video & Media Sniffer
- **Multi-Platform Video Sniffing:** Automatically detects video elements across major video and social platforms, including **YouTube, Facebook (Reels & Watch), TikTok, Instagram (Reels & Posts), Twitter / X, Vimeo, Dailymotion**, and raw **HLS / m3u8** streams.
- **Dynamic Post & Reel URL Resolution:** Accurately traverses DOM structures on dynamic infinite-scroll feeds (such as Facebook and Instagram reels) to extract the actual canonical post URL rather than generic feed endpoints.

### 🎯 Interactive In-Page Video Download Badge
- **On-Hover / Always-On Floating Badge:** Renders a sleek, non-intrusive floating download badge directly attached to detected video players.
- **Customizable Display Modes:**
  - `Never` *(Default)*: Hides the in-page badge completely while maintaining context menu and popup functionality.
  - `Hover`: Appears when hovering over any video player with an adjustable dismiss timer (1s – 10s).
  - `Always`: Permanently pins the badge to active/in-view video elements with smooth scrolling settlement.
- **Single-Click Download:** Click the badge to instantly dispatch the media stream to ThunderDM for high-speed segmented downloading and automated format assembly.

### 🍪 Advanced Cookie & Session Forwarding
- **Private & Authenticated Downloads:** Built-in option to forward browser cookies to ThunderDM desktop client for downloading private resources (e.g., files from private GitHub repositories, password-protected sites, or member-only media).
- **Dual-Layer Cookie Extraction:** Extracts both server-side/`HttpOnly` cookies (`API.cookies.getAll`) and client-side JavaScript cookies (`document.cookie`) when enabled.
- **Privacy-First (Default OFF):** Located under **Advanced Settings** and set to **OFF** by default. When turned off, zero cookies are accessed or transmitted.

### 🖱️ Context Menu Integration
- Right-click on any **image, video, audio element, link, or highlighted text** to trigger *"Download with ThunderDM"* directly from the browser context menu.

### 🛡️ Graceful Desktop Client Fallback
- If the ThunderDM desktop application is closed or browser integration is turned off, an in-page modal appears with options to **Download with browser** as a fallback or **Close**.

---

## 🏗️ Architecture & How It Works

```
┌─────────────────────────────────────────────────────────────┐
│                       Web Browser                           │
│                                                             │
│  ┌────────────────────────┐     ┌────────────────────────┐  │
│  │     Content Script     │     │     Extension Popup    │  │
│  │   (DOM & Video Badge)  │     │   (Status & Settings)  │  │
│  └───────────┬────────────┘     └───────────┬────────────┘  │
│              │                              │               │
│              └──────────────┬───────────────┘               │
│                             ▼                               │
│              ┌─────────────────────────────┐                │
│              │  Background Service Worker  │                │
│              │ (chrome.downloads, Cookies) │                │
│              └──────────────┬──────────────┘                │
└─────────────────────────────┼───────────────────────────────┘
                              │ HTTP POST /add (JSON)
                              │ HTTP GET /health
                              ▼
┌─────────────────────────────────────────────────────────────┐
│              ThunderDM Desktop Application                  │
│               Local Server (Port 37555)                     │
│                                                             │
│  ┌───────────────────────────────────────────────────────┐  │
│  │   Multi-Segment Engine  /  yt-dlp Engine  /  Queue     │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

1. **Content Script (`content.js` & `content.css`)**: Observes DOM mutations, tracks mouse movement, detects HTML5 `<video>` tags, and renders the floating badge. It also captures direct file download link clicks.
2. **Background Worker (`background.js`)**: Manages extension state, context menus, download event interception (`onCreated`, `onDeterminingFilename`), cookie extraction, and HTTP dispatching to the desktop client.
3. **Popup Interface (`popup.js` & `popup.html`)**: Provides real-time connection status monitoring, active tab info, download triggers, and configuration toggles.
4. **Desktop REST API**: The desktop client listens on local port `37555` (with fallback ports `57211` and `9988`) to receive incoming download jobs.

---

## 🚀 Building the Extension

The build system is written in pure Node.js with **zero external npm dependencies** (uses built-in `fs`, `path`, and `zlib` modules with a custom Deflate/CRC32 ZIP packager).

### Prerequisites
- **Node.js** (v14 or higher)

### Build Command
Run the build script from the `extension` directory or root project directory:

```bash
node build.js
```

This generates:
- **`dist/chromium/`** & **`dist/thunderDM-extension-chromium.zip`**: Manifest V3 package configured with a background service worker.
- **`dist/firefox/`**, **`dist/thunderDM-extension-firefox.zip`**, and **`dist/thunderDM-extension-firefox.xpi`**: Manifest V3 package configured with background scripts and Gecko application ID (`me@showayeb.dev`).

---

## 🌐 Installation Guide

### 1. Chromium-Based Browsers (Chrome, Edge, Brave, Opera, Vivaldi, Arc)

1. Open your browser and navigate to the extensions page:
   - **Google Chrome:** `chrome://extensions/`
   - **Microsoft Edge:** `edge://extensions/`
   - **Brave Browser:** `brave://extensions/`
   - **Opera:** `opera://extensions/`
   - **Vivaldi:** `vivaldi://extensions/`
2. Enable **Developer mode** (toggle switch located in the top-right corner or left sidebar).
3. Click the **"Load unpacked"** button.
4. Select the **`extension/dist/chromium`** directory.
5. The ThunderDM extension icon will appear in your browser toolbar. Pin it for quick access!

---

### 2. Mozilla Firefox & Gecko Forks (Firefox, Developer Edition, Zen, LibreWolf, etc.)

#### Method 1: Official Firefox Add-on Store (Recommended)
1. Open the official Add-on page: **[Thunder Download Manager on Firefox Add-ons](https://addons.mozilla.org/en-US/firefox/addon/thunder-download-manager/)**.
2. Click **"Add to Firefox"** to install instantly with automatic updates!

#### Method 2: Temporary Add-on (Development / Testing)
1. Open **`about:debugging#/runtime/this-firefox`** in your address bar.
2. Click **"Load Temporary Add-on..."**.
3. Select your **`.xpi`** or **`.zip`** extension file (e.g. `extension/dist/thunderDM-extension-firefox.xpi` or `extension/dist/firefox/manifest.json`).

> **Note:** This keeps the extension active until you close Firefox.

#### Method 3: Unsigned Permanent Installation (Firefox Developer Edition Setup)
1. **Download & Setup:** Download and install **Firefox Developer Edition** (or use Firefox Nightly, Firefox ESR, Zen Browser, LibreWolf, Floorp, or Waterfox).
2. Open the browser, type **`about:config`** in the address bar, press Enter, and on the warning page click **"Accept the Risk and Continue"**.
3. In the search bar, search for:
   ```
   xpinstall.signatures.required
   ```
   and double-click it to set its value to **`false`**.
4. Drag and drop the **`.xpi`** add-on file (`extension/dist/thunderDM-extension-firefox.xpi`) directly into the browser window, or install it via the Add-ons Manager (**`about:addons`** ➔ ⚙️ ➔ **"Install Add-on From File..."**).
5. **To Verify:** Completely close and reopen the browser; the extension will remain permanently active and enabled!

---

## 🎛️ Extension Popup & Settings

Clicking the ThunderDM icon in the browser toolbar opens the popup control panel:

| Setting / Control | Description |
| :--- | :--- |
| **Connection Status Indicator** | Displays real-time connectivity status with ThunderDM desktop client (`Connected`, `Offline`, `Disabled in App`, or `Checking...`). |
| **Current Page / Media Link** | Displays the active URL and page title, with a one-click clipboard copy button. |
| **Download with yt-dlp** | Sends the URL to ThunderDM using the `yt-dlp` media extraction engine for high-quality audio/video. |
| **Download with ThunderDM** | Sends the URL for multi-threaded segmented file download. |
| **Intercept Browser Downloads** | Toggle to turn automatic browser download interception ON or OFF. |
| **Video Download Badge Mode** | Select between `Show on Hover`, `Show Always`, or `Never Show`. |
| **Unhover Visible Duration** | Adjust how long the hover badge stays visible after moving the mouse away (1 to 10 seconds). |
| **Advanced Settings: Server Port** | Configure a custom local server port (default: `37555`). |
| **Advanced Settings: Pass Browser Cookies** | Toggle ON/OFF to forward server (`HttpOnly`) & client cookies with downloads for private repositories and authenticated streams (default: `OFF`). |
| **Advanced Settings: Test Connection** | Live connection test button to verify desktop client communication. |

---

## 📡 Desktop Integration Protocol

The extension communicates with the ThunderDM desktop application via local HTTP endpoints:

### 1. Add Download Task
- **Endpoint:** `POST http://127.0.0.1:37555/add` *(or custom configured port)*
- **Headers:** `Content-Type: application/json`
- **Payload Schema:**

```json
{
  "url": "https://example.com/files/archive.zip",
  "filename": "archive.zip",
  "referrer": "https://example.com/downloads",
  "cookies": "session_id=xyz; auth_token=abc",
  "user_agent": "Mozilla/5.0 ...",
  "is_ytdlp": false,
  "protocol": "Auto",
  "title": "Example Download"
}
```

- **Response:**
  - `200 OK`: Task successfully accepted by ThunderDM.
  - `403 Forbidden`: Browser integration is currently turned off in ThunderDM settings.
  - `Connection Refused`: ThunderDM desktop application is not running.

### 2. Health & Status Check
- **Endpoint:** `GET http://127.0.0.1:37555/health`
- **Response:**

```json
{
  "status": "ok",
  "app": "ThunderDM",
  "version": "1.0.0-beta",
  "browser_integration": true
}
```

---

## ❓ Troubleshooting & FAQ

#### 1. The extension says "Offline" or "Thunder Download Manager is not running in background"
- Ensure that the ThunderDM desktop application is open and running on your system.
- Check if your firewall or antivirus is blocking local loopback connections on port `37555`.
- Open **Advanced Settings** in the extension popup and click **Test Connection**.

#### 2. The extension badge says "Disabled in App"
- Open ThunderDM desktop application, go to **Settings**, and ensure **Browser Integration** is toggled **ON**.

#### 3. Why are `blob:` or `data:` URLs not sent to ThunderDM?
- `blob:` and `data:` URLs are temporary objects stored strictly in the browser tab's internal memory and cannot be accessed externally by another process. The extension gracefully routes these back to the browser's native download handler.

#### 4. How do I download files from private GitHub repositories or authenticated websites?
- Open the extension popup, expand **Advanced Settings**, and toggle **Pass Browser Cookies** to **ON**.
- Click the download link or button in your browser; the extension will forward the authenticated session cookies directly to ThunderDM.

#### 5. How do I change the connection port?
- If ThunderDM is running on a non-default port, open the extension popup, expand **Advanced Settings**, update the **Server Port**, and click **Test Connection**.

---

## 📄 License

Part of the **Thunder Download Manager** project.
