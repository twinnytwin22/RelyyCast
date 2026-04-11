#!/usr/bin/env bash

set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "RelyyDJ macOS doctor can only run on macOS."
  exit 1
fi

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=/dev/null
source "$ROOT_DIR/scripts/macos-common.sh"
macos_load_repo_env

SIGN_REQUESTED="${RELYY_MAC_SIGN:-0}"
NOTARIZE_REQUESTED="${RELYY_MAC_NOTARIZE:-0}"
DOCTOR_SCOPE="${RELYY_MAC_DOCTOR_SCOPE:-all}"
KEYCHAIN_PROFILE="${APPLE_KEYCHAIN_PROFILE:-${RELYY_NOTARY_PROFILE:-}}"
APPLE_API_KEY_PATH_VALUE="${APPLE_API_KEY_PATH:-}"
APPLE_API_KEY_ID_VALUE="${APPLE_API_KEY_ID:-}"
APPLE_API_ISSUER_VALUE="${APPLE_API_ISSUER:-${APPLE_API_ISSUER_ID:-}}"
TEAM_ID_VALUE="${APPLE_TEAM_ID:-${APPLE_DEVELOPER_TEAM_ID:-}}"
APPLE_SIGN_IDENTITY_VALUE="${APPLE_SIGN_IDENTITY:-}"
APPLE_ID_VALUE="${APPLE_ID:-${APPLE_DEVELOPER_ID:-}}"

case "$DOCTOR_SCOPE" in
  package|sign|release|all)
    ;;
  *)
    echo "Unsupported RELYY_MAC_DOCTOR_SCOPE value: $DOCTOR_SCOPE"
    echo "Supported values: package, sign, release, all"
    exit 1
    ;;
esac

SCOPE_NEEDS_TEAM_ID=0
SCOPE_NEEDS_SIGNING=0
SCOPE_NEEDS_NOTARIZATION=0
case "$DOCTOR_SCOPE" in
  sign)
    SCOPE_NEEDS_TEAM_ID=1
    SCOPE_NEEDS_SIGNING=1
    ;;
  release)
    SCOPE_NEEDS_TEAM_ID=1
    SCOPE_NEEDS_SIGNING=1
    SCOPE_NEEDS_NOTARIZATION=1
    ;;
  all)
    SCOPE_NEEDS_TEAM_ID=1
    SCOPE_NEEDS_SIGNING=1
    SCOPE_NEEDS_NOTARIZATION=1
    ;;
esac

if [[ "$SIGN_REQUESTED" == "1" ]]; then
  SCOPE_NEEDS_TEAM_ID=1
  SCOPE_NEEDS_SIGNING=1
fi

if [[ "$NOTARIZE_REQUESTED" == "1" ]]; then
  SCOPE_NEEDS_TEAM_ID=1
  SCOPE_NEEDS_SIGNING=1
  SCOPE_NEEDS_NOTARIZATION=1
fi

status_line() {
  local state="$1"
  local label="$2"
  local detail="${3:-}"

  printf '[%s] %s' "$state" "$label"
  if [[ -n "$detail" ]]; then
    printf ': %s' "$detail"
  fi
  printf '\n'
}

NEXT_STEPS=()
add_next_step() {
  local step="$1"
  local existing

  for existing in "${NEXT_STEPS[@]:-}"; do
    if [[ "$existing" == "$step" ]]; then
      return 0
    fi
  done

  NEXT_STEPS+=("$step")
}

echo "== RelyyDJ macOS doctor =="
echo "Repo: $ROOT_DIR"
echo "Scope: $DOCTOR_SCOPE"

BASE_READY=1
TEAM_READY=1
SIGNING_READY=1
NOTARIZATION_READY=1

XCODE_DIR=""
if ! command -v xcode-select >/dev/null 2>&1; then
  BASE_READY=0
  status_line "missing" "xcode-select" "Install Xcode and open it once so the command-line tools finish setup."
  add_next_step "Install or repair Xcode, then run xcode-select --switch /Applications/Xcode.app/Contents/Developer."
else
  if XCODE_DIR="$(xcode-select -p 2>/dev/null)"; then
    status_line "ok" "Xcode developer dir" "$XCODE_DIR"
  else
    BASE_READY=0
    status_line "missing" "Xcode developer dir" "The active developer directory is unavailable."
    add_next_step "Repair Xcode or run xcode-select --switch /Applications/Xcode.app/Contents/Developer."
  fi
fi

if xcrun --find notarytool >/dev/null 2>&1; then
  status_line "ok" "notarytool" "$(xcrun --find notarytool)"
else
  NOTARIZATION_READY=0
  status_line "missing" "notarytool" "Update Xcode before attempting notarization."
  add_next_step "Update Xcode until xcrun --find notarytool succeeds."
fi

if [[ "$SCOPE_NEEDS_TEAM_ID" == "1" ]]; then
  if [[ -z "$TEAM_ID_VALUE" ]]; then
    TEAM_ID_VALUE="$(macos_resolve_team_id)"
    export APPLE_TEAM_ID="$TEAM_ID_VALUE"
  else
    TEAM_ID_VALUE="$(macos_normalize_team_id "$TEAM_ID_VALUE")"
    export APPLE_TEAM_ID="$TEAM_ID_VALUE"
    macos_save_team_id "$TEAM_ID_VALUE"
  fi

  if macos_team_id_is_valid "$TEAM_ID_VALUE"; then
    status_line "ok" "Apple Team ID" "$TEAM_ID_VALUE"
  else
    TEAM_READY=0
    SIGNING_READY=0
    NOTARIZATION_READY=0
    status_line "missing" "Apple Team ID" "A valid 10-character Team ID is required."
    add_next_step "Set APPLE_TEAM_ID or rerun the script interactively and enter your Team ID."
  fi
else
  if [[ -n "$TEAM_ID_VALUE" ]]; then
    TEAM_ID_VALUE="$(macos_normalize_team_id "$TEAM_ID_VALUE")"
    status_line "ok" "Apple Team ID" "$TEAM_ID_VALUE"
  else
    status_line "info" "Apple Team ID" "Not required for the current scope."
  fi
fi

DEVELOPER_ID_IDENTITIES=()
while IFS= read -r identity; do
  if [[ -n "$identity" ]]; then
    DEVELOPER_ID_IDENTITIES+=("$identity")
  fi
done < <(macos_list_developer_identities)

MATCHING_IDENTITIES=()
if [[ "${#DEVELOPER_ID_IDENTITIES[@]}" -gt 0 ]]; then
  for identity in "${DEVELOPER_ID_IDENTITIES[@]}"; do
    MATCHING_IDENTITIES+=("$identity")
  done
fi

if [[ "${#DEVELOPER_ID_IDENTITIES[@]}" -eq 0 ]]; then
  SIGNING_READY=0
  status_line "missing" "Developer ID Application identity" "No signing identity is installed in the current keychain."
  if [[ -n "$TEAM_ID_VALUE" ]]; then
    macos_print_signing_setup_help "$TEAM_ID_VALUE"
  else
    macos_print_signing_setup_help
  fi
  add_next_step "Import a Developer ID Application certificate with its private key into Keychain Access."
else
  if [[ -n "$TEAM_ID_VALUE" ]]; then
    MATCHING_IDENTITIES=()
    while IFS= read -r identity; do
      if [[ -n "$identity" ]]; then
        MATCHING_IDENTITIES+=("$identity")
      fi
    done < <(macos_filter_identities_by_team_id "$TEAM_ID_VALUE" "${DEVELOPER_ID_IDENTITIES[@]}")
    if [[ "${#MATCHING_IDENTITIES[@]}" -eq 0 ]]; then
      SIGNING_READY=0
      status_line "missing" "Developer ID Application identity" "Installed identities do not match Apple Team ID $TEAM_ID_VALUE."
      status_line "info" "Installed identities" "$(printf '%s; ' "${DEVELOPER_ID_IDENTITIES[@]}" | sed 's/; $//')"
      add_next_step "Import the Developer ID Application certificate for Team ID $TEAM_ID_VALUE, or choose the correct Team ID."
    else
      status_line "ok" "Developer ID Application identities" "$(printf '%s; ' "${MATCHING_IDENTITIES[@]}" | sed 's/; $//')"
    fi
  else
    status_line "ok" "Developer ID Application identities" "$(printf '%s; ' "${DEVELOPER_ID_IDENTITIES[@]}" | sed 's/; $//')"
  fi
fi

if [[ "$SCOPE_NEEDS_SIGNING" == "1" && "$SIGNING_READY" == "1" ]]; then
  if [[ -n "$APPLE_SIGN_IDENTITY_VALUE" ]]; then
    if macos_identity_exists "$APPLE_SIGN_IDENTITY_VALUE" "${MATCHING_IDENTITIES[@]}"; then
      status_line "ok" "Selected signing identity" "$APPLE_SIGN_IDENTITY_VALUE"
    else
      SIGNING_READY=0
      status_line "missing" "Selected signing identity" "APPLE_SIGN_IDENTITY does not match any installed identity for the current team."
      add_next_step "Unset APPLE_SIGN_IDENTITY or choose an installed Developer ID Application identity for the selected team."
    fi
  elif [[ "${#MATCHING_IDENTITIES[@]}" -eq 1 ]]; then
    status_line "ok" "Selected signing identity" "${MATCHING_IDENTITIES[0]}"
  else
    status_line "info" "Selected signing identity" "A signing identity will be chosen interactively during sign/release."
  fi
fi

SAVED_APPLE_ID="$(macos_load_saved_apple_id)"
VALID_NOTARY_PROFILE=""
INVALID_NOTARY_PROFILE=""
if [[ -n "$KEYCHAIN_PROFILE" ]]; then
  if macos_notary_profile_is_valid "$KEYCHAIN_PROFILE"; then
    VALID_NOTARY_PROFILE="$KEYCHAIN_PROFILE"
  else
    INVALID_NOTARY_PROFILE="$KEYCHAIN_PROFILE"
  fi
else
  SAVED_PROFILE="$(macos_load_saved_notary_profile)"
  if [[ -n "$SAVED_PROFILE" ]]; then
    if macos_notary_profile_is_valid "$SAVED_PROFILE"; then
      VALID_NOTARY_PROFILE="$SAVED_PROFILE"
    else
      INVALID_NOTARY_PROFILE="$SAVED_PROFILE"
    fi
  fi
fi

if [[ "$SCOPE_NEEDS_NOTARIZATION" == "1" || "$DOCTOR_SCOPE" == "all" ]]; then
  if [[ -n "$VALID_NOTARY_PROFILE" ]]; then
    status_line "ok" "notarytool profile" "$VALID_NOTARY_PROFILE"
  elif [[ -n "$APPLE_API_KEY_PATH_VALUE" && -n "$APPLE_API_KEY_ID_VALUE" && -n "$APPLE_API_ISSUER_VALUE" ]]; then
    if [[ -f "$APPLE_API_KEY_PATH_VALUE" ]]; then
      status_line "ok" "App Store Connect API key" "$APPLE_API_KEY_PATH_VALUE"
    else
      NOTARIZATION_READY=0
      status_line "missing" "App Store Connect API key" "APPLE_API_KEY_PATH points to a missing file."
      add_next_step "Fix APPLE_API_KEY_PATH or use npm run electron:mac:notary:setup."
    fi
  else
    NOTARIZATION_READY=0
    if [[ -n "$INVALID_NOTARY_PROFILE" ]]; then
      status_line "missing" "notarytool profile" "Saved profile \"$INVALID_NOTARY_PROFILE\" is no longer valid."
    else
      status_line "missing" "notarytool profile" "No validated notarytool profile or API key is configured."
    fi

    if [[ -n "$SAVED_APPLE_ID" ]]; then
      status_line "info" "Remembered Apple ID" "$SAVED_APPLE_ID"
    fi
    macos_print_notary_setup_help
    add_next_step "Run npm run electron:mac:notary:setup."
  fi
fi

PACKAGE_READY="$BASE_READY"
if [[ "$BASE_READY" != "1" ]]; then
  SIGNING_READY=0
  NOTARIZATION_READY=0
fi

if [[ "$TEAM_READY" != "1" ]]; then
  SIGNING_READY=0
  NOTARIZATION_READY=0
fi

if [[ "$SIGNING_READY" != "1" ]]; then
  NOTARIZATION_READY=0
fi

echo
echo "Readiness:"
if [[ "$PACKAGE_READY" == "1" ]]; then
  status_line "ok" "Unsigned local package" "Ready"
else
  status_line "missing" "Unsigned local package" "Blocked by the base environment checks above."
fi

if [[ "$SIGNING_READY" == "1" ]]; then
  status_line "ok" "Signed mac build" "Ready"
else
  status_line "missing" "Signed mac build" "Blocked"
fi

if [[ "$NOTARIZATION_READY" == "1" ]]; then
  status_line "ok" "Signed + notarized release" "Ready"
else
  status_line "missing" "Signed + notarized release" "Blocked"
fi

if [[ "${#NEXT_STEPS[@]}" -gt 0 ]]; then
  echo
  echo "Next steps:"
  step_number=1
  for step in "${NEXT_STEPS[@]}"; do
    echo "  $step_number. $step"
    step_number=$((step_number + 1))
  done
fi

REQUIRED_READY=1
case "$DOCTOR_SCOPE" in
  package)
    REQUIRED_READY="$PACKAGE_READY"
    ;;
  sign)
    REQUIRED_READY="$SIGNING_READY"
    ;;
  release)
    REQUIRED_READY="$NOTARIZATION_READY"
    ;;
  all)
    REQUIRED_READY="$NOTARIZATION_READY"
    ;;
esac

if [[ "$REQUIRED_READY" == "1" ]]; then
  echo
  echo "macOS doctor passed."
  exit 0
fi

echo
echo "macOS doctor found blockers."
exit 1
