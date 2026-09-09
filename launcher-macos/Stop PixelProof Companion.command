#!/bin/zsh
set -eu

PID_FILE="$HOME/Library/Application Support/PixelProof Companion/companion.pid"
if [[ -f "$PID_FILE" ]]; then
  PID="$(cat "$PID_FILE")"
  if [[ "$PID" == <-> ]] && kill -0 "$PID" 2>/dev/null && ps -p "$PID" -o command= | grep -q 'PixelProof.*server.cjs\|companion/server.cjs'; then
    kill "$PID"
  fi
  rm -f "$PID_FILE"
fi
osascript -e 'display notification "本机伴侣已关闭。" with title "PixelProof Companion"' || true
