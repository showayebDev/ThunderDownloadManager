# Privacy Policy for Thunder Download Manager

**Effective Date:** September 7, 2026  
**Last Updated:** September 7, 2026

Thunder Download Manager ("ThunderDM", "we", "us", or "our") is dedicated to protecting user privacy. This Privacy Policy explains our practices regarding data collection, usage, and disclosure for the Thunder Download Manager desktop application and browser extension companion.

---

### 1. No Data Collection or Tracking
- **Zero Telemetry / Zero Analytics:** Thunder Download Manager does not collect, record, or track your personal information, browsing history, downloaded files, or online activities.
- **No Third-Party Transmission:** We do not sell, rent, trade, or transfer any user information to third-party advertisers, data brokers, or external servers.

---

### 2. Browser Extension Permissions & Usage
The browser extension functions solely as a local bridge between your web browser and the Thunder Download Manager desktop application installed on your computer.

- **Downloads (`downloads`):** Used strictly to detect browser downloads and transfer download jobs to ThunderDM for multi-threaded downloading.
- **Active Tab (`activeTab`):** Used to obtain the URL and title of the active tab when the extension popup is opened.
- **Context Menus (`contextMenus`):** Used to allow right-clicking on links, media, and selected text to trigger "Download with ThunderDM".
- **Local Storage (`storage`):** Used only to save your preferences locally on your machine (e.g., badge display modes, connection port).
- **In-Page Scripts (`scripting`, `<all_urls>`):** Used to detect media elements on active pages and render the floating download badge if enabled.
- **Cookies (`cookies`):** Completely optional. Used only when you explicitly turn ON "Pass Browser Cookies" in Advanced Settings to forward session cookies to your local desktop client for authenticated private downloads.

---

### 3. Localhost Communication
All communication between the browser extension and the desktop client occurs strictly over your local loopback network interface (`127.0.0.1` / `localhost`). No data leaves your personal computer.

---

### 4. Open Source & Transparency
Thunder Download Manager is open source. You can inspect all source code directly in our GitHub repository:  
https://github.com/showayebDev/ThunderDownloadManager

---

### 5. Contact
If you have any questions regarding this Privacy Policy, please open an issue on our GitHub repository:  
https://github.com/showayebDev/ThunderDownloadManager/issues
