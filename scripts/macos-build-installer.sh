#!/usr/bin/env bash

set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "RelyyDJ macOS installer packaging can only run on macOS."
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

if ! command -v pkgbuild >/dev/null 2>&1 || ! command -v productbuild >/dev/null 2>&1; then
  echo "macOS packaging tools are required (pkgbuild, productbuild)."
  exit 1
fi

echo "== RelyyDJ macOS installer build =="
echo "Arch: $ARCH"
echo "Signing enabled: $SIGN_REQUESTED"
echo "Notarization enabled: $NOTARIZE_REQUESTED"

echo "Building signed app bundle with Electron Forge package..."
cd "$ROOT_DIR"
RELYY_MAC_SIGN="$SIGN_REQUESTED" RELYY_MAC_NOTARIZE="$NOTARIZE_REQUESTED" bash "$ROOT_DIR/scripts/macos-release.sh" package

APP_PATH="$ROOT_DIR/out/RelyyDJ-darwin-$ARCH/RelyyDJ.app"
if [[ ! -d "$APP_PATH" ]]; then
  echo "Expected app bundle not found: $APP_PATH"
  exit 1
fi

APP_VERSION="$(node -p "require('./package.json').version")"
INSTALLER_DIR="$ROOT_DIR/out/installers/macos/$ARCH"
RESOURCES_DIR="$INSTALLER_DIR/resources"
DIST_FILE="$INSTALLER_DIR/distribution.xml"
COMPONENT_PKG_BASENAME="RelyyDJ-${APP_VERSION}-${ARCH}-component.pkg"
COMPONENT_PKG_PATH="$INSTALLER_DIR/$COMPONENT_PKG_BASENAME"
FINAL_PKG_PATH="$INSTALLER_DIR/RelyyDJ-${APP_VERSION}-${ARCH}.pkg"

rm -rf "$INSTALLER_DIR"
mkdir -p "$RESOURCES_DIR"

cp "$ROOT_DIR/LICENSE" "$RESOURCES_DIR/license.txt"
cat > "$RESOURCES_DIR/welcome.txt" <<EOF
Welcome to the RelyyDJ installer.

This installer places RelyyDJ in /Applications.
EOF
cat > "$RESOURCES_DIR/conclusion.txt" <<EOF
RelyyDJ has been installed.

You can launch it from Applications.
EOF

INSTALLER_SIGN_IDENTITY="${APPLE_INSTALLER_SIGN_IDENTITY:-}"
if [[ "$SIGN_REQUESTED" == "1" && -z "$INSTALLER_SIGN_IDENTITY" ]]; then
  echo "APPLE_INSTALLER_SIGN_IDENTITY is required when RELYY_MAC_SIGN=1."
  echo "Use a 'Developer ID Installer' certificate identity."
  exit 1
fi

PKGBUILD_ARGS=(
  --component "$APP_PATH"
  --install-location /Applications
  --identifier com.relyy.dj
  --version "$APP_VERSION"
)
if [[ -n "$INSTALLER_SIGN_IDENTITY" ]]; then
  PKGBUILD_ARGS+=(--sign "$INSTALLER_SIGN_IDENTITY")
fi
PKGBUILD_ARGS+=("$COMPONENT_PKG_PATH")

pkgbuild "${PKGBUILD_ARGS[@]}"

cat > "$DIST_FILE" <<EOF
<?xml version="1.0" encoding="utf-8"?>
<installer-gui-script minSpecVersion="1">
  <title>RelyyDJ Installer</title>
  <welcome file="welcome.txt"/>
  <license file="license.txt"/>
  <conclusion file="conclusion.txt"/>
  <options customize="never" require-scripts="false"/>
  <domains enable_anywhere="false" enable_currentUserHome="false" enable_localSystem="true"/>
  <choices-outline>
    <line choice="default">
      <line choice="com.relyy.dj.choice"/>
    </line>
  </choices-outline>
  <choice id="default"/>
  <choice id="com.relyy.dj.choice" visible="false">
    <pkg-ref id="com.relyy.dj.pkg"/>
  </choice>
  <pkg-ref id="com.relyy.dj.pkg" version="$APP_VERSION" onConclusion="none">$COMPONENT_PKG_BASENAME</pkg-ref>
</installer-gui-script>
EOF

PRODUCTBUILD_ARGS=(
  --distribution "$DIST_FILE"
  --resources "$RESOURCES_DIR"
  --package-path "$INSTALLER_DIR"
)
if [[ -n "$INSTALLER_SIGN_IDENTITY" ]]; then
  PRODUCTBUILD_ARGS+=(--sign "$INSTALLER_SIGN_IDENTITY")
fi
PRODUCTBUILD_ARGS+=("$FINAL_PKG_PATH")

productbuild "${PRODUCTBUILD_ARGS[@]}"

if [[ "$NOTARIZE_REQUESTED" == "1" ]]; then
  NOTARY_PROFILE="${APPLE_KEYCHAIN_PROFILE:-${RELYY_NOTARY_PROFILE:-}}"
  NOTARY_API_KEY_PATH="${APPLE_API_KEY_PATH:-}"
  NOTARY_API_KEY_ID="${APPLE_API_KEY_ID:-}"
  NOTARY_API_ISSUER="${APPLE_API_ISSUER:-${APPLE_API_ISSUER_ID:-}}"

  if [[ -n "$NOTARY_PROFILE" ]]; then
    NOTARY_ARGS=(submit "$FINAL_PKG_PATH" --wait --keychain-profile "$NOTARY_PROFILE")
    if [[ -n "${APPLE_KEYCHAIN_PATH:-}" ]]; then
      NOTARY_ARGS+=(--keychain "$APPLE_KEYCHAIN_PATH")
    fi
  elif [[ -n "$NOTARY_API_KEY_PATH" && -n "$NOTARY_API_KEY_ID" && -n "$NOTARY_API_ISSUER" ]]; then
    NOTARY_ARGS=(
      submit "$FINAL_PKG_PATH"
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
  xcrun stapler staple "$FINAL_PKG_PATH"
fi

echo "Installer ready: $FINAL_PKG_PATH"
