#!/usr/bin/env bash

set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "RelyyDJ macOS packaging can only run on macOS."
  exit 1
fi

ACTION="${1:-make}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=/dev/null
source "$ROOT_DIR/scripts/macos-common.sh"
macos_load_repo_env

RAW_ARCH="${RELYY_MAC_ARCH:-$(uname -m)}"
SIGN_REQUESTED="${RELYY_MAC_SIGN:-0}"
NOTARIZE_REQUESTED="${RELYY_MAC_NOTARIZE:-0}"
TEAM_ID_VALUE="${APPLE_TEAM_ID:-${APPLE_DEVELOPER_TEAM_ID:-}}"

case "$ACTION" in
  package|make)
    ;;
  *)
    echo "Usage: bash scripts/macos-release.sh [package|make]"
    exit 1
    ;;
esac

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

echo "== RelyyDJ macOS build =="
echo "Action: $ACTION"
echo "Arch: $ARCH"
echo "Signing enabled: $SIGN_REQUESTED"
echo "Notarization enabled: $NOTARIZE_REQUESTED"

DOCTOR_SCOPE="package"
if [[ "$SIGN_REQUESTED" == "1" && "$NOTARIZE_REQUESTED" == "1" ]]; then
  DOCTOR_SCOPE="release"
elif [[ "$SIGN_REQUESTED" == "1" ]]; then
  DOCTOR_SCOPE="sign"
fi

if [[ "$SIGN_REQUESTED" == "1" || "$NOTARIZE_REQUESTED" == "1" ]]; then
  if [[ -z "$TEAM_ID_VALUE" ]]; then
    TEAM_ID_VALUE="$(macos_resolve_team_id)"
    export APPLE_TEAM_ID="$TEAM_ID_VALUE"
  fi

  echo "Using Apple Team ID: ${TEAM_ID_VALUE}"
fi

APPLE_SIGN_IDENTITY="${APPLE_SIGN_IDENTITY:-}" APPLE_KEYCHAIN_PROFILE="${APPLE_KEYCHAIN_PROFILE:-}" APPLE_TEAM_ID="${TEAM_ID_VALUE:-}" RELYY_MAC_SIGN="$SIGN_REQUESTED" RELYY_MAC_NOTARIZE="$NOTARIZE_REQUESTED" RELYY_MAC_DOCTOR_SCOPE="$DOCTOR_SCOPE" \
  bash "$ROOT_DIR/scripts/macos-doctor.sh"

if [[ "$SIGN_REQUESTED" == "1" || "$NOTARIZE_REQUESTED" == "1" ]]; then
  if [[ -z "${APPLE_SIGN_IDENTITY:-}" ]]; then
    APPLE_SIGN_IDENTITY="$(macos_resolve_signing_identity)"
    export APPLE_SIGN_IDENTITY
  fi

  echo "Using signing identity: ${APPLE_SIGN_IDENTITY}"
fi

if [[ "$NOTARIZE_REQUESTED" == "1" ]]; then
  if [[ -z "${APPLE_KEYCHAIN_PROFILE:-}" && -z "${RELYY_NOTARY_PROFILE:-}" && -z "${APPLE_API_KEY_PATH:-}" ]]; then
    APPLE_KEYCHAIN_PROFILE="$(macos_resolve_notary_profile)"
    export APPLE_KEYCHAIN_PROFILE
  fi

  if [[ -n "${APPLE_KEYCHAIN_PROFILE:-}" ]]; then
    echo "Using notarytool keychain profile: ${APPLE_KEYCHAIN_PROFILE}"
  fi
fi

cd "$ROOT_DIR"
npx electron-forge "$ACTION" --platform=darwin --arch="$ARCH"
