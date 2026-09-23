#!/bin/zsh
set -euo pipefail

VERSION="${1:-0.3.1}"
SCRIPT_DIR="${0:A:h}"
PROJECT_ROOT="${SCRIPT_DIR:h}"
OUTPUT_ROOT="${PROJECT_ROOT:h}/PixelProof发布包"
PACKAGE_NAME="PixelProof-Companion-macOS-v${VERSION}"
PACKAGE_DIR="$OUTPUT_ROOT/$PACKAGE_NAME"
ZIP_PATH="$OUTPUT_ROOT/$PACKAGE_NAME.zip"
NODE_BIN="$(command -v node)"
NODE_ARCH="$(node -p 'process.arch')"

[[ "$(uname -s)" == "Darwin" ]] || { echo "请在 macOS 上执行此脚本。" >&2; exit 1; }
[[ -d "$PROJECT_ROOT/node_modules/playwright-core" ]] || { echo "请先在项目目录执行 npm install。" >&2; exit 1; }
[[ ! -e "$PACKAGE_DIR" && ! -e "$ZIP_PATH" ]] || { echo "输出已存在，请先备份或改用新版本号。" >&2; exit 1; }

mkdir -p "$PACKAGE_DIR/runtime" "$PACKAGE_DIR/app/companion"
if [[ -n "${PIXELPROOF_NODE_ARM64_BIN:-}" && -n "${PIXELPROOF_NODE_X64_BIN:-}" ]]; then
  [[ -x "$PIXELPROOF_NODE_ARM64_BIN" ]] || { echo "Apple Silicon Node runtime 不可执行。" >&2; exit 1; }
  [[ -x "$PIXELPROOF_NODE_X64_BIN" ]] || { echo "Intel Node runtime 不可执行。" >&2; exit 1; }
  cp "$PIXELPROOF_NODE_ARM64_BIN" "$PACKAGE_DIR/runtime/node-arm64"
  cp "$PIXELPROOF_NODE_X64_BIN" "$PACKAGE_DIR/runtime/node-x64"
else
  cp "$NODE_BIN" "$PACKAGE_DIR/runtime/node-$NODE_ARCH"
fi
if [[ -n "${PIXELPROOF_NODE_LICENSE:-}" && -f "$PIXELPROOF_NODE_LICENSE" ]]; then
  cp "$PIXELPROOF_NODE_LICENSE" "$PACKAGE_DIR/runtime/NODE-LICENSE.txt"
fi
cp "$PROJECT_ROOT/companion/server.cjs" "$PACKAGE_DIR/app/companion/server.cjs"
cp "$PROJECT_ROOT/companion/token-evidence.cjs" "$PACKAGE_DIR/app/companion/token-evidence.cjs"
cp -R "$PROJECT_ROOT/node_modules" "$PACKAGE_DIR/app/node_modules"
cp "$SCRIPT_DIR/PixelProof Companion.command" "$PACKAGE_DIR/PixelProof Companion.command"
cp "$SCRIPT_DIR/Stop PixelProof Companion.command" "$PACKAGE_DIR/Stop PixelProof Companion.command"
cp "$SCRIPT_DIR/使用说明.txt" "$PACKAGE_DIR/使用说明.txt"
chmod +x "$PACKAGE_DIR/runtime"/node-* "$PACKAGE_DIR/PixelProof Companion.command" "$PACKAGE_DIR/Stop PixelProof Companion.command"
ditto -c -k --sequesterRsrc --keepParent "$PACKAGE_DIR" "$ZIP_PATH"
shasum -a 256 "$ZIP_PATH" > "$OUTPUT_ROOT/$PACKAGE_NAME.sha256.txt"
echo "已生成：$ZIP_PATH"
