#!/usr/bin/env bash

set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "RelyyDJ macOS DMG packaging can only run on macOS."
  exit 1
fi

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=/dev/null
source "$ROOT_DIR/scripts/macos-common.sh"
macos_load_repo_env

RAW_ARCH="${RELYY_MAC_ARCH:-$(uname -m)}"
SIGN_REQUESTED="${RELYY_MAC_SIGN:-0}"
NOTARIZE_REQUESTED="${RELYY_MAC_NOTARIZE:-0}"

case "$RAW_ARCH" in
  arm64)
    ARCH="arm64"
    ;;
  x64|x86_64)
    ARCH="x64"
    ;;
  universal)
    ARCH="universal"
    ;;
  *)
    echo "Unsupported RELYY_MAC_ARCH value: $RAW_ARCH"
    echo "Supported values: arm64, x64, universal"
    exit 1
    ;;
esac

if ! command -v hdiutil >/dev/null 2>&1; then
  echo "hdiutil is required to build DMG installers."
  exit 1
fi

echo "== RelyyDJ macOS DMG build =="
echo "Arch: $ARCH"
echo "Signing enabled: $SIGN_REQUESTED"
echo "Notarization enabled: $NOTARIZE_REQUESTED"

echo "Building app bundle with Electron Forge package..."
cd "$ROOT_DIR"
RELYY_MAC_SIGN="$SIGN_REQUESTED" RELYY_MAC_NOTARIZE="$NOTARIZE_REQUESTED" bash "$ROOT_DIR/scripts/macos-release.sh" package

APP_PATH="$ROOT_DIR/out/RelyyDJ-darwin-$ARCH/RelyyDJ.app"
if [[ ! -d "$APP_PATH" ]]; then
  echo "Expected app bundle not found: $APP_PATH"
  exit 1
fi

APP_NAME="$(basename "$APP_PATH")"
APP_VERSION="$(node -p "require('./package.json').version")"
OUTPUT_DIR="$ROOT_DIR/out/installers/macos/$ARCH"
STAGING_DIR="$OUTPUT_DIR/dmg-staging"
RW_DMG="$OUTPUT_DIR/RelyyDJ-${APP_VERSION}-${ARCH}-rw.dmg"
FINAL_DMG="$OUTPUT_DIR/RelyyDJ-${APP_VERSION}-${ARCH}.dmg"
VOLUME_NAME="RelyyDJ Installer"

rm -rf "$STAGING_DIR"
mkdir -p "$STAGING_DIR"
rm -f "$RW_DMG" "$FINAL_DMG"

cp -R "$APP_PATH" "$STAGING_DIR/$APP_NAME"
ln -s /Applications "$STAGING_DIR/Applications"

hdiutil create -ov -fs HFS+ -format UDRW -volname "$VOLUME_NAME" -srcfolder "$STAGING_DIR" "$RW_DMG"

MOUNT_OUTPUT="$(hdiutil attach -readwrite -noverify -noautoopen "$RW_DMG")"
DEVICE="$(printf '%s\n' "$MOUNT_OUTPUT" | awk '/\/Volumes\// {print $1; exit}')"
MOUNT_POINT="$(printf '%s\n' "$MOUNT_OUTPUT" | awk -F '\t' '/\/Volumes\// {print $3; exit}')"

if [[ -z "$DEVICE" || -z "$MOUNT_POINT" ]]; then
  echo "Failed to mount DMG for customization."
  exit 1
fi

if command -v osascript >/dev/null 2>&1; then
  osascript <<OSA >/dev/null 2>&1 || true
tell application "Finder"
  tell disk "$VOLUME_NAME"
    open
    set current view of container window to icon view
    set toolbar visible of container window to false
    set statusbar visible of container window to false
    set the bounds of container window to {120, 120, 720, 430}
    set viewOptions to the icon view options of container window
    set arrangement of viewOptions to not arranged
    set icon size of viewOptions to 128
    set position of item "$APP_NAME" of container window to {170, 170}
    set position of item "Applications" of container window to {430, 170}
    close
    open
    update without registering applications
    delay 1
  end tell
end tell
OSA
fi

sync
hdiutil detach "$DEVICE"
hdiutil convert "$RW_DMG" -format UDZO -imagekey zlib-level=9 -o "$FINAL_DMG"
rm -f "$RW_DMG"
rm -rf "$STAGING_DIR"

if [[ "$NOTARIZE_REQUESTED" == "1" ]]; then
  NOTARY_PROFILE="${APPLE_KEYCHAIN_PROFILE:-${RELYY_NOTARY_PROFILE:-}}"
  NOTARY_API_KEY_PATH="${APPLE_API_KEY_PATH:-}"
  NOTARY_API_KEY_ID="${APPLE_API_KEY_ID:-}"
  NOTARY_API_ISSUER="${APPLE_API_ISSUER:-${APPLE_API_ISSUER_ID:-}}"

  if [[ -n "$NOTARY_PROFILE" ]]; then
    NOTARY_ARGS=(submit "$FINAL_DMG" --wait --keychain-profile "$NOTARY_PROFILE")
    if [[ -n "${APPLE_KEYCHAIN_PATH:-}" ]]; then
      NOTARY_ARGS+=(--keychain "$APPLE_KEYCHAIN_PATH")
    fi
  elif [[ -n "$NOTARY_API_KEY_PATH" && -n "$NOTARY_API_KEY_ID" && -n "$NOTARY_API_ISSUER" ]]; then
    NOTARY_ARGS=(
      submit "$FINAL_DMG"
      --wait
      --key "$NOTARY_API_KEY_PATH"
      --key-id "$NOTARY_API_KEY_ID"
      --issuer "$NOTARY_API_ISSUER"
    )
  else
    echo "Notarization requested, but no notary credentials found."
    echo "Set APPLE_KEYCHAIN_PROFILE (preferred) or APPLE_API_KEY_PATH/APPLE_API_KEY_ID/APPLE_API_ISSUER."
    exit 1
  fi

  xcrun notarytool "${NOTARY_ARGS[@]}"
  xcrun stapler staple "$FINAL_DMG"
fi

echo "DMG ready: $FINAL_DMG"
