#!/bin/zsh
set -eu

ROOT_DIR="${0:A:h}"
SUPPORT_DIR="$HOME/Library/Application Support/PixelProof Companion"
PID_FILE="$SUPPORT_DIR/companion.pid"
LOG_FILE="$SUPPORT_DIR/companion.log"
SERVER_FILE="$ROOT_DIR/app/companion/server.cjs"

case "$(uname -m)" in
  arm64) NODE_BIN="$ROOT_DIR/runtime/node-arm64" ;;
  x86_64) NODE_BIN="$ROOT_DIR/runtime/node-x64" ;;
  *) NODE_BIN="$ROOT_DIR/runtime/node" ;;
esac
if [[ ! -x "$NODE_BIN" && -x "$ROOT_DIR/runtime/node" ]]; then
  NODE_BIN="$ROOT_DIR/runtime/node"
fi

mkdir -p "$SUPPORT_DIR"
if curl -fsS --max-time 1 http://localhost:49321/health >/dev/null 2>&1; then
  osascript -e 'display notification "本机伴侣已在运行，请回到 Figma 重新检测。" with title "PixelProof Companion"' || true
  exit 0
fi
if [[ ! -x "$NODE_BIN" || ! -f "$SERVER_FILE" ]]; then
  osascript -e 'display dialog "发布包不完整或与这台 Mac 的芯片不兼容，请重新下载并完整解压。" with title "PixelProof Companion" buttons {"好"} default button 1 with icon stop'
  exit 1
fi

cd "$ROOT_DIR/app"
nohup "$NODE_BIN" "$SERVER_FILE" >>"$LOG_FILE" 2>&1 &
echo $! > "$PID_FILE"
sleep 1
if curl -fsS --max-time 2 http://localhost:49321/health >/dev/null 2>&1; then
  osascript -e 'display notification "已启动，可回到 Figma 开始检查。" with title "PixelProof Companion"' || true
else
  osascript -e 'display dialog "启动失败，请检查 ~/Library/Application Support/PixelProof Companion/companion.log" with title "PixelProof Companion" buttons {"好"} default button 1 with icon stop'
  exit 1
fi
