#!/bin/bash
set -e

echo "========================================================"
echo "    Thunder Download Manager (ThunderDM) Uninstaller   "
echo "========================================================"

# 1. Terminate running instances
echo "[1/5] Stopping running ThunderDM processes..."
pkill -f "Thunder Download Manager" || true
pkill -f "ThunderDownloadManager" || true
pkill -f "ThunderDM" || true

# 2. Remove application bundles
echo "[2/5] Removing application bundles from /Applications..."
rm -rf "/Applications/Thunder Download Manager.app" || true
rm -rf "/Applications/ThunderDownloadManager.app" || true
rm -rf "$HOME/Applications/Thunder Download Manager.app" || true
rm -rf "$HOME/Applications/ThunderDownloadManager.app" || true

# 3. Purge ~/.thunderdm (settings, config, yt-dlp binaries, and history)
echo "[3/5] Purging settings, engine configurations and data (~/.thunderdm)..."
rm -rf "$HOME/.thunderdm" || true
rm -rf "$HOME/.ThunderDM" || true

# 4. Remove LaunchAgents autostart plist
echo "[4/5] Removing autostart LaunchAgent..."
rm -f "$HOME/Library/LaunchAgents/com.thunderdm.thunderdm.plist" || true

# 5. Clean Application Support and Caches
echo "[5/5] Cleaning macOS application support and caches..."
rm -rf "$HOME/Library/Application Support/com.thunderdm.thunderdm" || true
rm -rf "$HOME/Library/Application Support/ThunderDM" || true
rm -rf "$HOME/Library/Application Support/ThunderDownloadManager" || true
rm -rf "$HOME/Library/Caches/com.thunderdm.thunderdm" || true
rm -rf "$HOME/Library/Caches/ThunderDM" || true
rm -rf "$HOME/Library/Preferences/com.thunderdm.thunderdm.plist" || true

echo "Thunder Download Manager and ~/.thunderdm have been completely uninstalled from macOS!"
