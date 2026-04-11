#!/usr/bin/env bash

set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "RelyyDJ macOS notarization setup can only run on macOS."
  exit 1
fi

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=/dev/null
source "$ROOT_DIR/scripts/macos-common.sh"
macos_load_repo_env

if ! command -v xcrun >/dev/null 2>&1 || ! xcrun --find notarytool >/dev/null 2>&1; then
  echo "notarytool is unavailable. Update Xcode before setting up notarization."
  exit 1
fi

TEAM_ID_VALUE="${APPLE_TEAM_ID:-${APPLE_DEVELOPER_TEAM_ID:-}}"
PROFILE_NAME="${APPLE_KEYCHAIN_PROFILE:-${RELYY_NOTARY_PROFILE:-}}"
APPLE_ID_VALUE="${APPLE_ID:-}"

if [[ -z "$TEAM_ID_VALUE" ]]; then
  TEAM_ID_VALUE="$(macos_resolve_team_id)"
fi

if [[ -z "$APPLE_ID_VALUE" ]]; then
  APPLE_ID_VALUE="$(macos_resolve_apple_id)"
fi

if [[ -z "$PROFILE_NAME" ]]; then
  PROFILE_NAME="$(macos_prompt_notary_profile "Choose a notarytool keychain profile name" "$(macos_load_saved_notary_profile)")"
fi

echo "== RelyyDJ notarytool setup =="
echo "Team ID: $TEAM_ID_VALUE"
echo "Apple ID: $APPLE_ID_VALUE"
echo "Profile: $PROFILE_NAME"

args=(store-credentials "$PROFILE_NAME" --team-id "$TEAM_ID_VALUE" --validate)

args+=(--apple-id "$APPLE_ID_VALUE")

if [[ -n "${APPLE_KEYCHAIN_PATH:-}" ]]; then
  args+=(--keychain "${APPLE_KEYCHAIN_PATH}")
fi

echo "notarytool will prompt for any missing Apple credentials."
xcrun notarytool "${args[@]}"

macos_save_team_id "$TEAM_ID_VALUE"
macos_save_apple_id "$APPLE_ID_VALUE"
macos_save_notary_profile "$PROFILE_NAME"

echo "Saved Team ID, Apple ID, and notarization profile for future runs."

DEVELOPER_ID_IDENTITIES=()
while IFS= read -r identity; do
  if [[ -n "$identity" ]]; then
    DEVELOPER_ID_IDENTITIES+=("$identity")
  fi
done < <(macos_list_developer_identities)

MATCHING_IDENTITIES=()
if [[ "${#DEVELOPER_ID_IDENTITIES[@]}" -gt 0 ]]; then
  while IFS= read -r identity; do
    if [[ -n "$identity" ]]; then
      MATCHING_IDENTITIES+=("$identity")
    fi
  done < <(macos_filter_identities_by_team_id "$TEAM_ID_VALUE" "${DEVELOPER_ID_IDENTITIES[@]}")
fi

if [[ "${#MATCHING_IDENTITIES[@]}" -eq 0 ]]; then
  echo
  echo "Notarization credentials are ready, but signing is still blocked."
  macos_print_signing_setup_help "$TEAM_ID_VALUE"
fi
