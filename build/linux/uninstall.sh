#!/bin/sh
set -e

echo "========================================================"
echo "    Thunder Download Manager (ThunderDM) Uninstaller   "
echo "========================================================"

# 1. Terminate running processes
echo "[1/4] Stopping active ThunderDM processes..."
if command -v pkill >/dev/null 2>&1; then
  pkill -f "ThunderDownloadManager" || true
  pkill -f "thunderdm" || true
elif command -v killall >/dev/null 2>&1; then
  killall ThunderDownloadManager || true
  killall thunderdm || true
fi

# 2. Remove desktop launcher & icons
echo "[2/4] Removing desktop shortcuts and application files..."
rm -f /usr/local/bin/ThunderDownloadManager || true
rm -f /usr/bin/ThunderDownloadManager || true
rm -f /usr/share/applications/ThunderDownloadManager.desktop || true
rm -f "$HOME/.local/share/applications/ThunderDownloadManager.desktop" || true
rm -f /usr/share/icons/hicolor/128x128/apps/ThunderDownloadManager.png || true
rm -f "$HOME/.local/share/icons/ThunderDownloadManager.png" || true

# 3. Remove autostart entries
echo "[3/4] Removing autostart entries..."
rm -f /etc/xdg/autostart/thunderdm.desktop || true
rm -f /etc/xdg/autostart/ThunderDownloadManager.desktop || true
rm -f "$HOME/.config/autostart/thunderdm.desktop" || true
rm -f "$HOME/.config/autostart/ThunderDownloadManager.desktop" || true

# 4. Remove user database, config, and helper binaries (~/.thunderdm)
echo "[4/4] Purging settings, engine configurations and data (~/.thunderdm)..."
rm -rf "$HOME/.thunderdm" || true
rm -rf "$HOME/.ThunderDM" || true

# Update desktop & MIME databases if available
if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database -q /usr/share/applications || true
fi
if command -v update-mime-database >/dev/null 2>&1; then
  update-mime-database -n /usr/share/mime || true
fi

echo "Thunder Download Manager and ~/.thunderdm have been successfully uninstalled!"
