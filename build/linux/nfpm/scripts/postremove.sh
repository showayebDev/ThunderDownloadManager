#!/bin/sh
set -e

# 1. Clean up user data and configuration folder ~/.thunderdm for all users & root
if [ -n "$HOME" ] && [ -d "$HOME/.thunderdm" ]; then
  rm -rf "$HOME/.thunderdm" || true
fi

rm -rf /root/.thunderdm || true

for d in /home/*; do
  if [ -d "$d/.thunderdm" ]; then
    rm -rf "$d/.thunderdm" || true
  fi
  if [ -d "$d/.ThunderDM" ]; then
    rm -rf "$d/.ThunderDM" || true
  fi
done

# 2. Update desktop and MIME databases
if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database -q /usr/share/applications || true
fi

if command -v update-mime-database >/dev/null 2>&1; then
  update-mime-database -n /usr/share/mime || true
fi

exit 0

