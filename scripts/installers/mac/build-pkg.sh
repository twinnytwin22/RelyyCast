#!/bin/bash
# build-pkg.sh — builds a signed, notarized RelyyCast.pkg for macOS
#
# Usage:
#   ./build-pkg.sh [--skip-sign] [--skip-notarize]
#
# Required env vars for signing:
#   APPLE_SIGN_APP       — "Developer ID Application: Randal Herndon (8938LN7846)"
#   APPLE_SIGN_PKG       — "Developer ID Installer: Randal Herndon (8938LN7846)"
#
# Required env vars for notarization (or stored keychain profile):
#   APPLE_ID             — your Apple ID email
#   APPLE_APP_PASSWORD   — app-specific password from appleid.apple.com
#   APPLE_TEAM_ID        — 8938LN7846
#   NOTARIZE_PROFILE     — (optional) keychain credential profile name created via
#                          `xcrun notarytool store-credentials`; if set, env vars are ignored
#
# Outputs:
#   dist/RelyyCast.pkg

set -euo pipefail

# -----------------------------------------------------------------------
# Paths
# -----------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
DIST_SRC="$REPO_ROOT/dist/relyycast"
DIST_OUT="$REPO_ROOT/dist"
STAGING="$REPO_ROOT/dist/_pkg-staging"
SCRIPTS_STAGING="$STAGING/_scripts"
PKG_RESOURCES="$STAGING/_pkg-resources"

APP_NAME="RelyyCast"
APP_VERSION="0.1.0"
APP_BUNDLE="$APP_NAME.app"
BUNDLE_ID="com.relyycast.app"
TEAM_ID="${APPLE_TEAM_ID:-8938LN7846}"

# Default signing identities (can be overridden by env)
SIGN_APP="${APPLE_SIGN_APP:-Developer ID Application: Randal Herndon ($TEAM_ID)}"
SIGN_PKG="${APPLE_SIGN_PKG:-Developer ID Installer: Randal Herndon ($TEAM_ID)}"

# -----------------------------------------------------------------------
# Flag parsing
# -----------------------------------------------------------------------
SKIP_SIGN=false
SKIP_NOTARIZE=false

for arg in "$@"; do
    case "$arg" in
        --skip-sign)      SKIP_SIGN=true ;;
        --skip-notarize)  SKIP_NOTARIZE=true ;;
    esac
done

# Auto-skip signing if required certs are unavailable.
HAS_APP_SIGN_CERT=true
HAS_INSTALLER_SIGN_CERT=true

if ! security find-identity -v -p codesigning 2>/dev/null | grep -q "Developer ID Application"; then
    HAS_APP_SIGN_CERT=false
fi

if ! security find-identity -v -p basic 2>/dev/null | grep -q "Developer ID Installer"; then
    HAS_INSTALLER_SIGN_CERT=false
fi

if [ "$HAS_APP_SIGN_CERT" = false ] || [ "$HAS_INSTALLER_SIGN_CERT" = false ]; then
    if [ "$HAS_APP_SIGN_CERT" = false ]; then
        echo "[pkg] WARNING: No 'Developer ID Application' cert found in keychain — skipping signing"
    fi
    if [ "$HAS_INSTALLER_SIGN_CERT" = false ]; then
        echo "[pkg] WARNING: No 'Developer ID Installer' cert found in keychain — skipping signing"
    fi
    SKIP_SIGN=true
    SKIP_NOTARIZE=true
fi

# -----------------------------------------------------------------------
# Helpers
# -----------------------------------------------------------------------
log() { echo "[pkg] $*"; }

require_file() {
    if [ ! -e "$1" ]; then
        echo "[pkg] ERROR: Required file not found: $1"
        exit 1
    fi
}

sign_binary() {
    local binary="$1"
    local entitlements="${2:-}"
    if $SKIP_SIGN; then return 0; fi
    if [ -n "$entitlements" ]; then
        codesign --force --options runtime --entitlements "$entitlements" \
            --sign "$SIGN_APP" --timestamp "$binary"
    else
        codesign --force --options runtime \
            --sign "$SIGN_APP" --timestamp "$binary"
    fi
    log "  signed: $(basename "$binary")"
}

sign_resource() {
    local resource="$1"
    if $SKIP_SIGN; then return 0; fi
    codesign --force --sign "$SIGN_APP" --timestamp "$resource"
    log "  signed resource: $(basename "$resource")"
}

# -----------------------------------------------------------------------
# Preflight checks
# -----------------------------------------------------------------------
log "Checking source files..."
require_file "$DIST_SRC/relyycast-mac_universal"
require_file "$DIST_SRC/resources.neu"
require_file "$DIST_SRC/build/mediamtx/mac/mediamtx"
require_file "$DIST_SRC/build/mediamtx/mediamtx.yml"
require_file "$DIST_SRC/build/bin/cloudflared"

MP3_HELPER="$DIST_SRC/build/bin/relyy-mp3-helper"
HAS_MP3_HELPER=false
if [ -f "$MP3_HELPER" ]; then
    HAS_MP3_HELPER=true
    if ! $SKIP_SIGN; then
        TMP_MP3_SIGN_CHECK="$(mktemp /tmp/relyycast-mp3-signcheck.XXXXXX)"
        cp "$MP3_HELPER" "$TMP_MP3_SIGN_CHECK"
        if ! codesign --force --sign "$SIGN_APP" --timestamp "$TMP_MP3_SIGN_CHECK" >/dev/null 2>&1; then
            HAS_MP3_HELPER=false
            log "WARNING: MP3 helper found but cannot be code-signed on this machine — skipping optional component package"
        else
            log "MP3 helper found — will build optional component package"
        fi
        rm -f "$TMP_MP3_SIGN_CHECK"
    else
        log "MP3 helper found — will build optional component package"
    fi
else
    log "MP3 helper not found — skipping optional component package"
fi

# -----------------------------------------------------------------------
# Clean staging
# -----------------------------------------------------------------------
log "Preparing staging directory..."
rm -rf "$STAGING"
mkdir -p "$STAGING"

# -----------------------------------------------------------------------
# Build .app bundle structure
# -----------------------------------------------------------------------
log "Building $APP_BUNDLE..."

MACOS_DIR="$STAGING/$APP_BUNDLE/Contents/MacOS"
mkdir -p "$MACOS_DIR/build/mediamtx/mac"
mkdir -p "$MACOS_DIR/build/bin"
mkdir -p "$STAGING/$APP_BUNDLE/Contents/Resources"

# Main binary (rename to clean name inside the bundle)
cp "$DIST_SRC/relyycast-mac_universal" "$MACOS_DIR/relyycast"
chmod +x "$MACOS_DIR/relyycast"

# Neutralino resources
cp "$DIST_SRC/resources.neu" "$MACOS_DIR/resources.neu"

# MediaMTX
cp "$DIST_SRC/build/mediamtx/mac/mediamtx" "$MACOS_DIR/build/mediamtx/mac/mediamtx"
cp "$DIST_SRC/build/mediamtx/mediamtx.yml"  "$MACOS_DIR/build/mediamtx/mediamtx.yml"
chmod +x "$MACOS_DIR/build/mediamtx/mac/mediamtx"

# Cloudflare Tunnel
cp "$DIST_SRC/build/bin/cloudflared" "$MACOS_DIR/build/bin/cloudflared"
chmod +x "$MACOS_DIR/build/bin/cloudflared"

# Info.plist
cp "$SCRIPT_DIR/Info.plist" "$STAGING/$APP_BUNDLE/Contents/Info.plist"

# App icon (convert favicon.ico → icns if iconutil is available, else copy as-is)
FAVICON="$REPO_ROOT/public/favicon.ico"
if [ -f "$FAVICON" ]; then
    cp "$FAVICON" "$STAGING/$APP_BUNDLE/Contents/Resources/AppIcon.icns" 2>/dev/null || true
fi

# -----------------------------------------------------------------------
# Sign binaries
# -----------------------------------------------------------------------
log "Signing binaries..."
CHILD_ENTITLEMENTS="$SCRIPT_DIR/child-entitlements.plist"
APP_ENTITLEMENTS="$SCRIPT_DIR/entitlements.plist"

sign_binary "$MACOS_DIR/build/mediamtx/mac/mediamtx"  "$CHILD_ENTITLEMENTS"
sign_binary "$MACOS_DIR/build/bin/cloudflared"          "$CHILD_ENTITLEMENTS"
# resources.neu lives beside the app executable and is treated as a nested
# signed component by codesign. Sign it explicitly before signing relyycast.
sign_resource "$MACOS_DIR/resources.neu"
# mediamtx.yml is also inside Contents/MacOS and must be signed as a blob.
sign_resource "$MACOS_DIR/build/mediamtx/mediamtx.yml"
sign_binary "$MACOS_DIR/relyycast"                      "$APP_ENTITLEMENTS"

if ! $SKIP_SIGN; then
    log "Signing .app bundle..."
    codesign --force --deep --options runtime \
        --entitlements "$APP_ENTITLEMENTS" \
        --sign "$SIGN_APP" --timestamp \
        "$STAGING/$APP_BUNDLE"
    codesign --verify --deep --strict "$STAGING/$APP_BUNDLE"
    log "  .app bundle signature valid"
fi

# -----------------------------------------------------------------------
# Build pkg-scripts staging
# -----------------------------------------------------------------------
mkdir -p "$SCRIPTS_STAGING/core"
cp "$SCRIPT_DIR/preinstall.sh"  "$SCRIPTS_STAGING/core/preinstall"
cp "$SCRIPT_DIR/postinstall.sh" "$SCRIPTS_STAGING/core/postinstall"
chmod +x "$SCRIPTS_STAGING/core/preinstall" "$SCRIPTS_STAGING/core/postinstall"

# -----------------------------------------------------------------------
# pkgbuild: core component pkg
# -----------------------------------------------------------------------
CORE_PKG="$STAGING/RelyyCast-core.pkg"
log "Building core component package..."

# Stage root: the app bundle ends up at /Applications/RelyyCast.app
APP_ROOT="$STAGING/_app-root"
mkdir -p "$APP_ROOT"
cp -R "$STAGING/$APP_BUNDLE" "$APP_ROOT/$APP_BUNDLE"

pkgbuild \
    --root "$APP_ROOT" \
    --identifier "${BUNDLE_ID}" \
    --version "$APP_VERSION" \
    --install-location "/Applications" \
    --scripts "$SCRIPTS_STAGING/core" \
    "$CORE_PKG"

log "  core pkg: $CORE_PKG"

# -----------------------------------------------------------------------
# pkgbuild: optional MP3 helper component pkg
# -----------------------------------------------------------------------
MP3_PKG="$STAGING/RelyyCast-mp3helper.pkg"

if $HAS_MP3_HELPER; then
    log "Building MP3 helper component package..."

    MP3_ROOT="$STAGING/_mp3-root"
    mkdir -p "$MP3_ROOT/Applications/RelyyCast.app/Contents/MacOS/build/bin"
    cp "$MP3_HELPER" "$MP3_ROOT/Applications/RelyyCast.app/Contents/MacOS/build/bin/relyy-mp3-helper"
    chmod +x "$MP3_ROOT/Applications/RelyyCast.app/Contents/MacOS/build/bin/relyy-mp3-helper"

    if ! $SKIP_SIGN; then
        sign_binary \
            "$MP3_ROOT/Applications/RelyyCast.app/Contents/MacOS/build/bin/relyy-mp3-helper" \
            "$CHILD_ENTITLEMENTS"
    fi

    pkgbuild \
        --root "$MP3_ROOT" \
        --identifier "${BUNDLE_ID}.mp3helper" \
        --version "$APP_VERSION" \
        --install-location "/" \
        "$MP3_PKG"

    log "  mp3helper pkg: $MP3_PKG"
fi

# -----------------------------------------------------------------------
# productbuild: assemble distribution installer
# -----------------------------------------------------------------------
mkdir -p "$PKG_RESOURCES"
cp "$SCRIPT_DIR/welcome.html"     "$PKG_RESOURCES/welcome.html"
cp "$REPO_ROOT/LICENSE"           "$PKG_RESOURCES/LICENSE"

# Patch distribution.xml: remove mp3helper line if binary not present
DIST_XML="$PKG_RESOURCES/distribution.xml"
cp "$SCRIPT_DIR/distribution.xml" "$DIST_XML"

if ! $HAS_MP3_HELPER; then
    # Remove mp3helper choice and pkg-ref entries from distribution
    sed -i '' '/<line choice="com.relyycast.app.mp3helper"/d' "$DIST_XML"
    sed -i '' '/<choice id="com.relyycast.app.mp3helper"/,/<\/choice>/d' "$DIST_XML"
    sed -i '' '/<pkg-ref id="com.relyycast.app.mp3helper"/d' "$DIST_XML"
fi

UNSIGNED_PKG="$DIST_OUT/RelyyCast-unsigned.pkg"
FINAL_PKG="$DIST_OUT/RelyyCast.pkg"

log "Running productbuild..."

PRODUCTBUILD_ARGS=(
    --distribution "$DIST_XML"
    --resources "$PKG_RESOURCES"
    --package-path "$STAGING"
    --version "$APP_VERSION"
)

productbuild "${PRODUCTBUILD_ARGS[@]}" "$UNSIGNED_PKG"
log "  unsigned pkg: $UNSIGNED_PKG"

# -----------------------------------------------------------------------
# Sign the installer pkg
# -----------------------------------------------------------------------
if ! $SKIP_SIGN; then
    log "Signing installer package..."
    productsign --sign "$SIGN_PKG" --timestamp "$UNSIGNED_PKG" "$FINAL_PKG"
    rm -f "$UNSIGNED_PKG"
    log "  signed pkg: $FINAL_PKG"
else
    mv "$UNSIGNED_PKG" "$FINAL_PKG"
    log "  (unsigned) pkg: $FINAL_PKG"
fi

# -----------------------------------------------------------------------
# Notarization
# -----------------------------------------------------------------------
if $SKIP_SIGN || $SKIP_NOTARIZE; then
    log "Skipping notarization."
else
    log "Submitting for notarization..."

    if [ -n "${NOTARIZE_PROFILE:-}" ]; then
        # Use stored keychain credentials profile (preferred for local dev)
        xcrun notarytool submit "$FINAL_PKG" \
            --keychain-profile "$NOTARIZE_PROFILE" \
            --wait
    elif [ -n "${APPLE_ID:-}" ] && [ -n "${APPLE_APP_PASSWORD:-}" ]; then
        # Use env var credentials (CI / automated builds)
        xcrun notarytool submit "$FINAL_PKG" \
            --apple-id "$APPLE_ID" \
            --password "$APPLE_APP_PASSWORD" \
            --team-id "$TEAM_ID" \
            --wait
    else
        echo "[pkg] WARNING: No notarization credentials found."
        echo "  Set NOTARIZE_PROFILE (keychain) or APPLE_ID + APPLE_APP_PASSWORD + APPLE_TEAM_ID."
        echo "  Skipping notarization — pkg will trigger Gatekeeper warnings on first launch."
    fi

    log "Stapling notarization ticket..."
    xcrun stapler staple "$FINAL_PKG"
    log "  staple complete"
fi

# -----------------------------------------------------------------------
# Clean up staging
# -----------------------------------------------------------------------
rm -rf "$STAGING"

log ""
log "Done! Installer: $FINAL_PKG"
log ""
log "To set up notarization credentials (one-time, stored in keychain):"
log "  xcrun notarytool store-credentials \"relyycast-notarization\" \\"
log "    --apple-id YOUR_APPLE_ID@email.com \\"
log "    --team-id 8938LN7846 \\"
log "    --password YOUR_APP_SPECIFIC_PASSWORD"
log "Then set: export NOTARIZE_PROFILE=relyycast-notarization"
