#!/bin/sh
set -e

# Terminate running instances
if command -v pkill >/dev/null 2>&1; then
  pkill -f "ThunderDownloadManager" || true
elif command -v killall >/dev/null 2>&1; then
  killall ThunderDownloadManager || true
fi

# Remove system-wide and user autostart entries
rm -f /etc/xdg/autostart/thunderdm.desktop || true
rm -f /etc/xdg/autostart/ThunderDownloadManager.desktop || true

for d in /home/*; do
  if [ -d "$d" ]; then
    rm -f "$d/.config/autostart/thunderdm.desktop" || true
    rm -f "$d/.config/autostart/ThunderDownloadManager.desktop" || true
  fi
done

if [ -n "$HOME" ] && [ -d "$HOME" ]; then
  rm -f "$HOME/.config/autostart/thunderdm.desktop" || true
  rm -f "$HOME/.config/autostart/ThunderDownloadManager.desktop" || true
fi

exit 0

