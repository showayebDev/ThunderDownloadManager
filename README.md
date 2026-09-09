<p align="center">
  <img src="build/appicon.png" width="128" height="128" alt="Thunder Download Manager Logo" />
</p>

<h1 align="center">Thunder Download Manager (ThunderDM)</h1>

<p align="center">
  <strong>An ultra-fast, modern, multi-threaded download manager with intelligent browser integration, dynamic segmentation, and media streaming support.</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Go-1.25+-00ADD8?style=for-the-badge&logo=go&logoColor=white" alt="Go Version" />
  <img src="https://img.shields.io/badge/Wails-v3-DF0000?style=for-the-badge&logo=wails&logoColor=white" alt="Wails v3" />
  <img src="https://img.shields.io/badge/React-19-61DAFB?style=for-the-badge&logo=react&logoColor=black" alt="React 19" />
  <img src="https://img.shields.io/badge/TailwindCSS-v4-06B6D4?style=for-the-badge&logo=tailwindcss&logoColor=white" alt="Tailwind CSS v4" />
  <img src="https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20Linux-555555?style=for-the-badge" alt="Platforms" />
  <a href="https://addons.mozilla.org/en-US/firefox/addon/thunder-download-manager/"><img src="https://img.shields.io/badge/Firefox_Add--on-Official_Extension-FF7139?style=for-the-badge&logo=firefox-browser&logoColor=white" alt="Firefox Add-on" /></a>
</p>

---

## 📋 Table of Contents

- [Overview](#-overview)
- [Key Features](#-key-features)
- [Batch Download Engine](#-batch-download-engine)
- [Browser Companion Extension](#-browser-companion-extension)
- [Tech Stack & Architecture](#-tech-stack--architecture)
- [Getting Started & Development](#-getting-started--development)
  - [Prerequisites](#prerequisites)
  - [Installation & Setup](#installation--setup)
  - [Running in Development](#running-in-development)
  - [Building Production Binaries](#building-production-binaries)
- [Desktop Integration Protocol](#-desktop-integration-protocol)
- [Taskfile Commands Reference](#-taskfile-commands-reference)
- [License](#-license)

---

## 🚀 Overview

**Thunder Download Manager (ThunderDM)** is a next-generation desktop download manager engineered for maximum speed, security, and convenience. Powered by **Go** and **Wails v3** on the backend and **React 19** with **Tailwind CSS v4** on the frontend, ThunderDM brings a modern, sleek UI alongside low-level networking optimizations.

It features a custom high-performance multi-segment download engine that dynamically splits files into concurrent byte ranges, pools TCP connections, supports native **HLS (`.m3u8`)** stream assembly, captures video and streaming media, and connects effortlessly with all major web browsers via its companion extension.

---

## ✨ Key Features

### ⚡ Multi-Threaded Dynamic File Segmentation
- Accelerates download speeds up to 500% by splitting files into dynamic multi-threaded byte-range segments.
- Real-time connection pooling, zero-allocation network buffers, and automatic chunk reallocation.
- Full pause, resume, cancel, and restart capabilities with automated file integrity verification.

### 📦 Advanced Batch Download Engine & Recursive Crawler
- **Pattern & Multi-Wildcard Sequence Generator:** Generate dozens or hundreds of sequential download links using asterisks (`*`) or bracket expressions (`[01-50]`, `[01-50:2]`, `[a-z:2]`).
- **Multi-Wildcard (`*_*`) Cartesian Product:** Support multiple independent wildcards in a single URL (e.g. `season_*_episode_*.mp4`) with dedicated configuration tabs for each wildcard.
- **Custom Interval / Step Settings:** Generate odd/even numbers (`1, 3, 5, 7...` with step 2), custom intervals (`0, 5, 10, 15...` with step 5), or alphabetical steps (`a, c, e...`).
- **Bulk URL List & File Ingestion:** Paste multiple links at once or import plain `.txt` files with automatic URL sanitization.
- **Recursive Webpage Link Sniffer & Directory Crawler:** Traverse entire BDIX, FTP, Apache, Nginx, h5ai, and Alist server directories across multiple levels (depth 1 to 5), with subfolder filtering and automatic local directory hierarchy reconstruction.

### 🎬 High-Resolution Video & Media Streaming Capture
- Capture and download media from **YouTube, Facebook, TikTok, Instagram, Twitter / X, Vimeo, Dailymotion**, and 1,000+ streaming sites with built-in format selection.
- Interactive quality and format picker (4K, 1080p, 720p, MP3/Audio-only) with automated stream remuxing.

### 📺 Native HLS / m3u8 Stream Downloader
- Custom high-speed `.m3u8` playlist parser, AES-128 decryptor, and multi-segment stream assembly engine for live and VOD streams.

### 🎨 Rich Appearance & 9 Handcrafted Theme Palettes
- **9 Handcrafted Theme Palettes:** Choose between *Zinc (Monochrome), OLED (Pure Black), Midnight (Deep Navy), Violet, Emerald, Rose, Amber, Cyan, and Classic Blue*.
- **Custom Typography & Sizing:** Select any installed system font with live rendering preview, adjust base font size (9px – 18px), and toggle compact top bar and icon labels.

### 🌍 Multi-Language Interface (i18n)
- Comprehensive internationalization supporting **English, বাংলা (Bengali), Español (Spanish), Français (French), and Deutsch (German)** with instantaneous language switching.

### 💾 Pure SQLite Relational Database Engine
- **Zero JSON Config Files:** 100% centralized, robust persistence using pure Go SQLite (`~/.thunderdm/thunderdm.db`).
- Atomic ACID transactions, automatic schema migrations, WAL mode for lightning-fast reads/writes, and zero data corruption.

### 🌐 System Proxy, PAC & SOCKS5 Routing Engine
- Supports **Direct, System Proxy (Windows Registry & OS Network auto-detection), PAC (Proxy Auto-Configuration script evaluation with in-memory caching), and Manual SOCKS5 / HTTP** modes.
- Granular CIDR and wildcard bypass lists (`localhost`, `127.0.0.1`, `192.168.0.0/16`, `*.local`).
- Built-in proxy connection tester with live latency and external IP verification.

### 🍪 Browser Cookie & Authenticated Downloading
- Supports forwarding browser cookies (`HttpOnly` & client-side) to download private files (such as assets from private GitHub repositories, password-protected sites, or member-only media).

### 🔐 Site Credentials Vault & Basic Auth
- Encrypted local vault to store site credentials (username & password) that auto-matches target hostnames and authenticates downloads and recursive crawler sessions seamlessly.

### 🛡️ Antivirus Verification & Real-Time File Integrity Checksums
- **CI/CD ClamAV Antivirus Scanned:** All official release binaries are scanned with ClamAV antivirus and verified clean with published security certificates.
- Built-in checksum validator supporting **SHA-256, SHA-512, MD5, SHA-1, and CRC32** hashes to guarantee downloaded file integrity.

### ⏳ Advanced Queue Manager & Scheduler
- Create, prioritize, and manage multiple download queues with custom concurrency limits.
- Multi-item right-click queue assignment, instant *"Without Queue"* downloads, and scheduled start/stop automation.
- **Granular Queue Window Controls:** Configure *Show real time download process* and *Download compression window* popups individually per queue (disabled by default for silent background operation).
- **One-Click Stop All:** Instantly halts all active queues and running/pending/queued downloads with immediate background stream cancellation.

### ⚠️ Settings "Danger Zone" & App Reset
- Dedicated Danger Zone for resetting preferences to defaults or executing a complete clean purge of `~/.thunderdm` app data with double confirmation safeguards.

### 🎛️ Granular Bandwidth Limiter
- Granular global and per-download speed throttling to prevent network congestion.

### 🔔 System Tray & Desktop Integration
- Smooth minimize-to-tray background service with native desktop notifications.
- Single-instance protection with automatic window restore and CLI argument parsing.
- Default-enabled automatic launch on system boot (**Start On Boot**) syncing with native OS startup registries across Windows, macOS, and Linux.

---

## 📦 Batch Download Engine

ThunderDM features a full-fledged batch ingestion system with three dedicated modes:

### 1. Pattern / Sequence Generation
Generate structured download links matching numerical or alphabetical patterns:

- **Single Wildcard (`*`)**: `http://example.com/files/document_*.pdf`
  - Set Range: `From: 1`, `To: 10`, `Digit Padding: 2` $\rightarrow$ `document_01.pdf` to `document_10.pdf`
- **Interval / Step (e.g. 1, 3, 5...)**:
  - `From: 1`, `To: 9`, `Interval / Step: 2` $\rightarrow$ `file_1.txt`, `file_3.txt`, `file_5.txt`, `file_7.txt`, `file_9.txt`
  - `From: 0`, `To: 20`, `Interval / Step: 5` $\rightarrow$ `0, 5, 10, 15, 20`
- **Multiple Wildcards (`*_*`)**: `http://site.com/season_*_episode_*.mp4`
  - Configures Wildcard #1 (`Season 1..2`) and Wildcard #2 (`Episode 1..3`) to generate all 6 combination URLs via Cartesian product.
- **Bracket Range Syntax**:
  - `http://site.com/part_[01-20].zip` (padded 01 to 20)
  - `http://site.com/lesson_[1-15:2].mp4` (step 2: 1, 3, 5...)
  - `http://site.com/archive_[a-z:2].tar` (step 2: a, c, e...)

### 2. Text / URL List & File Ingestion
- Paste bulk URL lists directly into the text area (one link per line).
- Click **Import TXT** to load `.txt` files containing download links.
- Automatically normalizes URLs, ignores blank lines, and detects file categories.

### 3. Webpage Link Sniffer & Recursive Subfolder Crawler
- **Recursive Directory Traversal:** Crawls BDIX movie servers, TV series libraries, FTP open directories, Apache/Nginx auto-indexes, h5ai, and Alist instances to find all downloadable files nested within subfolders (e.g., `Season 01/`, `Season 02/`).
- **Configurable Crawl Depth:** Set recursion depth from 1 to 5 levels with automated circular link protection.
- **Subfolder Filter & Quick Batch Selection:** Filter scanned items by specific subfolders or use the "Select Folder" / "Deselect Folder" buttons to batch toggle seasons and folders.
- **Recreate Subfolders on Disk:** Enable *Recreate Subfolders on Disk* to automatically create the exact remote directory structure on your local storage (e.g., saving `Season 1/Episode 01.mkv` into `<DownloadFolder>/Season 1/Episode 01.mkv`).
- **Site Credentials Vault Integration:** Automatically injects stored Basic or Bearer authentication headers when scanning protected directory trees.
- **Category & Keyword Filtering:** Instantly filter discovered links by category (Video, Audio, Document, Archive, Software) and probe remote file sizes in real time before downloading.

### 4. Resilient Ingestion & Live Registration Overlay
- **Live Ingestion Progress Overlay:** Interactive progress bar and file counter during high-volume batch registrations to ensure fluid UI responsiveness.
- **Intelligent Filename Deduplication:** Automatically detects and resolves filename collisions without overwriting existing files or downloads.
- **Batch Display Controls:** Dedicated toggles for *Save by file category*, *Show real time progress window*, and *Show completion window*.

---

## 🌐 Browser Companion Extension

ThunderDM includes an official high-performance companion browser extension built with **Manifest V3** for Chromium-based browsers (Chrome, Edge, Brave, Opera, Vivaldi, Arc) and Mozilla Firefox.

<p align="center">
  <a href="https://addons.mozilla.org/en-US/firefox/addon/thunder-download-manager/">
    <img src="https://img.shields.io/badge/Mozilla_Firefox-Get_Extension-FF7139?style=for-the-badge&logo=firefox-browser&logoColor=white" alt="Firefox Add-on" />
  </a>
</p>

### Extension Highlights:
- **Automatic Interception:** Captures browser downloads (`chrome.downloads` API) and direct file links (`.zip`, `.rar`, `.iso`, `.exe`, `.mp4`, etc.) and routes them to ThunderDM.
- **Smart Video Sniffer & Floating Badge:** Renders an in-page floating download badge over detected video elements for instant one-click media capture.
- **Pass Browser Cookies Toggle:** Option under Advanced Settings to forward session cookies for downloading private repository files and authenticated media.
- **Fallback In-Page Modal:** Clean dialog offering native browser download fallback if the desktop client is offline.

👉 **For complete extension documentation, build steps, and browser installation guides, please see the [Extension README](extension/README.md).**

---

## 🏗️ Tech Stack & Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                 ThunderDM Application Stack                 │
│                                                             │
│   ┌─────────────────────────────────────────────────────┐   │
│   │                     Frontend                        │   │
│   │    React 19  •  TypeScript  •  Tailwind CSS v4      │   │
│   │    Vite  •  Lucide Icons  •  Wails v3 Runtime       │   │
│   └──────────────────────────┬──────────────────────────┘   │
│                              │ IPC Bindings                 │
│                              ▼                              │
│   ┌─────────────────────────────────────────────────────┐   │
│   │                   Go Backend Engine                 │   │
│   │  • Multi-Segment Downloader (Chunk Engine & Limiter)│   │
│   │  • Recursive Web Link Crawler & Directory Sniffer   │   │
│   │  • HLS Parser & yt-dlp Video Extractor              │   │
│   │  • System Proxy, PAC Evaluator & SOCKS5 Routing     │   │
│   │  • Queue Scheduler & Task Manager                   │   │
│   │  • Pure SQLite Database Engine (modernc.org/sqlite) │   │
│   │  • Encrypted Vault Storage                          │   │
│   │  • Local REST Server (Port 37555 for Extension)     │   │
│   │  • System Tray, Single-Instance & Autostart         │   │
│   └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

- **Backend:** [Go](https://go.dev/) (1.25+) with [Wails v3](https://v3.wails.io/)
- **Database:** [Pure Go SQLite](https://gitlab.com/cznic/sqlite) (`modernc.org/sqlite`)
- **Frontend:** [React](https://react.dev/) 19, [TypeScript](https://www.typescriptlang.org/), [Tailwind CSS](https://tailwindcss.com/) v4, [Vite](https://vite.dev/)
- **Media Engine:** [yt-dlp](https://github.com/yt-dlp/yt-dlp) & [ffmpeg](https://ffmpeg.org/)
- **Security & CI/CD:** [ClamAV](https://www.clamav.net/) Automated Antivirus Scanning on GitHub Actions
- **Browser Extension:** Manifest V3 (Chromium & Firefox)

---

## 🛠️ Getting Started & Development

### Prerequisites
- **Go:** `v1.25` or higher ([Download](https://golang.org/dl/))
- **Node.js:** `v18` or higher ([Download](https://nodejs.org/))
- **Wails CLI:** `v3.0.0-beta` or higher (`go install github.com/wailsapp/wails/v3/cmd/wails3@latest`)
- **Task Runner (Optional):** [Taskfile](https://taskfile.dev/) (`go install github.com/go-task/task/v3/cmd/task@latest`)

### Installation & Setup

1. **Clone the repository:**
   ```bash
   git clone https://github.com/showayebDev/ThunderDownloadManager.git
   cd ThunderDownloadManager
   ```

2. **Install frontend dependencies:**
   ```bash
   cd frontend
   npm install
   cd ..
   ```

3. **Install Go dependencies:**
   ```bash
   go mod tidy
   ```

### Running in Development

Start the development server with live reload and Vite hot-reloading:

```bash
# Using Task
wails3 dev

# Or directly with Wails v3
wails3 dev -config ./build/config.yml -port 9245
```

### Building Production Binaries

Build production packages for your operating system:

```bash
# Build for current host platform
wails3 task build

# Create platform installer/package
wails3 task package
```

### Building the Browser Extension

Build the Chrome and Firefox extension packages (`dist/` output):

```bash
wails3 task ext
# or run directly:
node extension/build.js
```

---

## 📡 Desktop Integration Protocol

ThunderDM runs a lightweight internal HTTP server on **port `37555`** (with fallback ports `57211` and `9988`) to receive download jobs from the browser extension and CLI tools:

- **Add Download Task:** `POST http://127.0.0.1:37555/add`
- **Health & Integration Check:** `GET http://127.0.0.1:37555/health`

---

## 📜 Taskfile Commands Reference

| Task Command | Description |
| :--- | :--- |
| `wails3 dev` | Runs the application in development mode with live reload. |
| `wails3 task build` | Compiles the production binary for the current OS. |
| `wails3 task package` | Packages a single universal production installer for Windows. |
| `wails3 task package:all:platforms` | Cross-compiles packages for Windows, macOS (Universal), and Linux. |
| `wails3 task ext` | Builds unpacked directories and ZIP/XPI archives for Chrome & Firefox extensions. |
| `wails3 task generate_icon` | Generates high-resolution application icons and platform icon sets. |
| `wails3 task set:version VERSION=x.y.z` | Synchronizes application version across all platform config files. |

---

## 📄 License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.

