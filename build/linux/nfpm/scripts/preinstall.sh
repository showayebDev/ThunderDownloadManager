#!/bin/sh
set -e

# Terminate any running instance before installing or upgrading
if command -v pkill >/dev/null 2>&1; then
  pkill -f "ThunderDownloadManager" || true
elif command -v killall >/dev/null 2>&1; then
  killall ThunderDownloadManager || true
fi

exit 0

