#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOCAL_STATE_DIR="$ROOT_DIR/.local"
SIGNING_STATE_FILE="$LOCAL_STATE_DIR/macos-signing.env"

macos_load_env_file() {
  local env_file="$1"
  local had_allexport=0

  if [[ ! -f "$env_file" ]]; then
    return 0
  fi

  if [[ "$-" == *a* ]]; then
    had_allexport=1
  fi

  set -a
  # shellcheck source=/dev/null
  source "$env_file"

  if [[ "$had_allexport" -eq 0 ]]; then
    set +a
  fi
}

macos_load_repo_env() {
  macos_load_env_file "$ROOT_DIR/.env"
  macos_load_env_file "$ROOT_DIR/.env.local"

  if [[ -z "${APPLE_API_ISSUER:-}" && -n "${APPLE_API_ISSUER_ID:-}" ]]; then
    export APPLE_API_ISSUER="$APPLE_API_ISSUER_ID"
  fi
}

macos_state_saved_sign_identity() {
  if [[ ! -f "$SIGNING_STATE_FILE" ]]; then
    return 0
  fi

  local saved_identity=""
  # shellcheck source=/dev/null
  source "$SIGNING_STATE_FILE"
  saved_identity="${RELYY_SAVED_APPLE_SIGN_IDENTITY:-}"

  if [[ -n "$saved_identity" ]]; then
    printf '%s\n' "$saved_identity"
  fi
}

macos_state_saved_notary_profile() {
  if [[ ! -f "$SIGNING_STATE_FILE" ]]; then
    return 0
  fi

  local saved_profile=""
  # shellcheck source=/dev/null
  source "$SIGNING_STATE_FILE"
  saved_profile="${RELYY_SAVED_APPLE_KEYCHAIN_PROFILE:-}"

  if [[ -n "$saved_profile" ]]; then
    printf '%s\n' "$saved_profile"
  fi
}

macos_state_saved_team_id() {
  if [[ ! -f "$SIGNING_STATE_FILE" ]]; then
    return 0
  fi

  local saved_team_id=""
  # shellcheck source=/dev/null
  source "$SIGNING_STATE_FILE"
  saved_team_id="${RELYY_SAVED_APPLE_TEAM_ID:-}"

  if [[ -n "$saved_team_id" ]]; then
    printf '%s\n' "$saved_team_id"
  fi
}

macos_state_saved_apple_id() {
  if [[ ! -f "$SIGNING_STATE_FILE" ]]; then
    return 0
  fi

  local saved_apple_id=""
  # shellcheck source=/dev/null
  source "$SIGNING_STATE_FILE"
  saved_apple_id="${RELYY_SAVED_APPLE_ID:-}"

  if [[ -n "$saved_apple_id" ]]; then
    printf '%s\n' "$saved_apple_id"
  fi
}

macos_print_signing_setup_help() {
  local team_id="${1:-}"

  echo "What is still missing for signing:"
  if [[ -n "$team_id" ]]; then
    echo "  1. Create or locate a \"Developer ID Application\" certificate for Apple Team ID $team_id in Apple Developer."
  else
    echo "  1. Create or locate a \"Developer ID Application\" certificate in Apple Developer."
  fi
  echo "  2. Make sure this Mac has the private key for that certificate."
  echo "  3. If this Mac did not create the certificate, export the certificate plus private key as a .p12 from the original Mac and import that .p12 here."
  echo "  4. Re-run: security find-identity -p codesigning -v"
}

macos_print_notary_setup_help() {
  echo "What is still missing for notarization:"
  echo "  1. Run: npm run electron:mac:notary:setup"
  echo "  2. Enter your Apple ID email address, Apple Team ID, and an app-specific password."
  echo "  3. Re-run: npm run electron:mac:doctor"
}

macos_write_state_file() {
  local identity="$1"
  local profile="$2"
  local team_id="$3"
  local apple_id="$4"

  mkdir -p "$LOCAL_STATE_DIR"
  {
    printf 'RELYY_SAVED_APPLE_SIGN_IDENTITY=%q\n' "$identity"
    printf 'RELYY_SAVED_APPLE_KEYCHAIN_PROFILE=%q\n' "$profile"
    printf 'RELYY_SAVED_APPLE_TEAM_ID=%q\n' "$team_id"
    printf 'RELYY_SAVED_APPLE_ID=%q\n' "$apple_id"
  } > "$SIGNING_STATE_FILE"
}

macos_is_interactive() {
  [[ -r /dev/tty && -w /dev/tty ]] || [[ -t 0 && -t 1 ]] || command -v osascript >/dev/null 2>&1
}

macos_tty_print() {
  if ! macos_is_interactive; then
    printf '%s\n' "$*" >&2
    return 1
  fi

  if [[ -r /dev/tty && -w /dev/tty ]]; then
    printf '%s\n' "$*" > /dev/tty
  else
    printf '%s\n' "$*" >&2
  fi
}

macos_gui_prompt_read() {
  local prompt="$1"
  local default_value="${2:-}"

  if ! command -v osascript >/dev/null 2>&1; then
    return 1
  fi

  osascript -l JavaScript - "$prompt" "$default_value" <<'JXA'
function run(argv) {
  var app = Application.currentApplication();
  app.includeStandardAdditions = true;
  var result = app.displayDialog(argv[0], {
    defaultAnswer: argv[1],
    buttons: ["Cancel", "OK"],
    defaultButton: "OK"
  });
  return result.textReturned;
}
JXA
}

macos_gui_prompt_yes_no() {
  local prompt="$1"
  local default_answer="${2:-yes}"
  local default_button="Yes"

  if [[ "$default_answer" == "no" ]]; then
    default_button="No"
  fi

  if ! command -v osascript >/dev/null 2>&1; then
    return 1
  fi

  osascript -l JavaScript - "$prompt" "$default_button" <<'JXA'
function run(argv) {
  var app = Application.currentApplication();
  app.includeStandardAdditions = true;
  var result = app.displayDialog(argv[0], {
    buttons: ["No", "Yes"],
    defaultButton: argv[1]
  });
  return result.buttonReturned;
}
JXA
}

macos_tty_prompt_read() {
  local prompt="$1"
  local reply=""

  if ! macos_is_interactive; then
    echo "A prompt is required, but no terminal or GUI prompt transport is available." >&2
    return 1
  fi

  if [[ -r /dev/tty && -w /dev/tty ]]; then
    printf '%s' "$prompt" > /dev/tty
    IFS= read -r reply < /dev/tty || return 1
  elif [[ -t 0 && -t 1 ]]; then
    printf '%s' "$prompt" >&2
    IFS= read -r reply || return 1
  else
    reply="$(macos_gui_prompt_read "$prompt")" || return 1
  fi

  printf '%s\n' "$reply"
}

macos_list_developer_identities() {
  security find-identity -p codesigning -v 2>/dev/null | awk -F '"' '/Developer ID Application/ { print $2 }'
}

macos_identity_exists() {
  local needle="$1"
  shift

  local candidate
  for candidate in "$@"; do
    if [[ "$candidate" == "$needle" ]]; then
      return 0
    fi
  done

  return 1
}

macos_load_saved_signing_identity() {
  macos_state_saved_sign_identity
}

macos_save_signing_identity() {
  local identity="$1"
  local profile
  local team_id
  local apple_id
  profile="$(macos_state_saved_notary_profile)"
  team_id="$(macos_state_saved_team_id)"
  apple_id="$(macos_state_saved_apple_id)"
  macos_write_state_file "$identity" "$profile" "$team_id" "$apple_id"
}

macos_prompt_yes_no() {
  local prompt="$1"
  local default_answer="${2:-yes}"
  local suffix="[Y/n]"
  local default_value="yes"

  if [[ "$default_answer" == "no" ]]; then
    suffix="[y/N]"
    default_value="no"
  fi

  while true; do
    local reply=""
    if [[ -r /dev/tty && -w /dev/tty ]] || [[ -t 0 && -t 1 ]]; then
      reply="$(macos_tty_prompt_read "$prompt $suffix ")" || return 1
    else
      reply="$(macos_gui_prompt_yes_no "$prompt" "$default_answer")" || return 1
    fi
    reply="$(printf '%s' "$reply" | tr '[:upper:]' '[:lower:]')"

    if [[ -z "$reply" ]]; then
      reply="$default_value"
    fi

    case "$reply" in
      y|yes)
        return 0
        ;;
      n|no)
        return 1
        ;;
    esac

    macos_tty_print "Please answer yes or no."
  done
}

macos_choose_identity_interactively() {
  local saved_identity="$1"
  shift
  local identities=("$@")

  if [[ -n "$saved_identity" ]] && macos_identity_exists "$saved_identity" "${identities[@]}"; then
    macos_tty_print "Remembered signing identity:"
    macos_tty_print "  $saved_identity"

    if macos_prompt_yes_no "Use the remembered signing identity?" "yes"; then
      printf '%s\n' "$saved_identity"
      return 0
    fi
  fi

  macos_tty_print "Available Developer ID Application identities:"
  local index=1
  local identity
  for identity in "${identities[@]}"; do
    macos_tty_print "  $index) $identity"
    index=$((index + 1))
  done

  while true; do
    local choice=""
    choice="$(macos_tty_prompt_read "Choose a signing identity [1-${#identities[@]}]: ")" || return 1

    if [[ "$choice" =~ ^[0-9]+$ ]] && (( choice >= 1 && choice <= ${#identities[@]} )); then
      printf '%s\n' "${identities[choice-1]}"
      return 0
    fi

    macos_tty_print "Please enter a number between 1 and ${#identities[@]}."
  done
}

macos_normalize_team_id() {
  local value="${1:-}"
  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"
  printf '%s\n' "$(printf '%s' "$value" | tr '[:lower:]' '[:upper:]')"
}

macos_team_id_is_valid() {
  local team_id
  team_id="$(macos_normalize_team_id "${1:-}")"
  [[ "$team_id" =~ ^[A-Z0-9]{10}$ ]]
}

macos_identity_matches_team_id() {
  local identity="$1"
  local team_id="$2"
  [[ "$identity" == *"(${team_id})"* ]]
}

macos_filter_identities_by_team_id() {
  local team_id="$1"
  shift

  local identity
  for identity in "$@"; do
    if macos_identity_matches_team_id "$identity" "$team_id"; then
      printf '%s\n' "$identity"
    fi
  done
}

macos_load_saved_team_id() {
  macos_state_saved_team_id
}

macos_save_team_id() {
  local team_id
  local identity
  local profile
  local apple_id

  team_id="$(macos_normalize_team_id "$1")"
  identity="$(macos_state_saved_sign_identity)"
  profile="$(macos_state_saved_notary_profile)"
  apple_id="$(macos_state_saved_apple_id)"
  macos_write_state_file "$identity" "$profile" "$team_id" "$apple_id"
}

macos_prompt_team_id() {
  local initial_value="${1:-}"
  local team_id=""

  while true; do
    if [[ -n "$initial_value" ]]; then
      team_id="$(macos_tty_prompt_read "Apple Team ID [$initial_value]: ")" || return 1
      team_id="${team_id:-$initial_value}"
    else
      team_id="$(macos_tty_prompt_read "Apple Team ID: ")" || return 1
    fi

    team_id="$(macos_normalize_team_id "$team_id")"

    if macos_team_id_is_valid "$team_id"; then
      printf '%s\n' "$team_id"
      return 0
    fi

    macos_tty_print "Apple Team ID should look like a 10-character value such as ABCD123456."
  done
}

macos_resolve_team_id() {
  local explicit_team_id="${APPLE_TEAM_ID:-${APPLE_DEVELOPER_TEAM_ID:-}}"
  local saved_team_id
  saved_team_id="$(macos_load_saved_team_id)"

  if [[ -n "$explicit_team_id" ]]; then
    explicit_team_id="$(macos_normalize_team_id "$explicit_team_id")"
    if macos_team_id_is_valid "$explicit_team_id"; then
      macos_save_team_id "$explicit_team_id"
      printf '%s\n' "$explicit_team_id"
      return 0
    fi

    echo "APPLE_TEAM_ID was provided but is not a valid Team ID." >&2
    return 1
  fi

  if [[ -n "$saved_team_id" ]]; then
    if ! macos_is_interactive; then
      printf '%s\n' "$saved_team_id"
      return 0
    fi

    macos_tty_print "Remembered Apple Team ID:"
    macos_tty_print "  $saved_team_id"

    if macos_prompt_yes_no "Use the remembered Apple Team ID?" "yes"; then
      printf '%s\n' "$saved_team_id"
      return 0
    fi
  fi

  if ! macos_is_interactive; then
    echo "No Apple Team ID is configured." >&2
    echo "Set APPLE_TEAM_ID explicitly or rerun this command in an interactive terminal." >&2
    return 1
  fi

  local selected_team_id=""
  selected_team_id="$(macos_prompt_team_id "$saved_team_id")"
  macos_save_team_id "$selected_team_id"
  printf '%s\n' "$selected_team_id"
}

macos_resolve_signing_identity() {
  local IFS=$'\n'
  local identities=($(macos_list_developer_identities))
  local filtered_identities=()
  local explicit_identity="${APPLE_SIGN_IDENTITY:-}"
  local team_id="${APPLE_TEAM_ID:-${APPLE_DEVELOPER_TEAM_ID:-}}"
  local saved_identity
  saved_identity="$(macos_load_saved_signing_identity)"

  if [[ -n "$explicit_identity" ]]; then
    if macos_identity_exists "$explicit_identity" "${identities[@]}"; then
      macos_save_signing_identity "$explicit_identity"
      printf '%s\n' "$explicit_identity"
      return 0
    fi

    echo "APPLE_SIGN_IDENTITY was provided but does not match any installed Developer ID Application identity." >&2
    return 1
  fi

  if [[ "${#identities[@]}" -eq 0 ]]; then
    echo "No Developer ID Application identity was found in the current keychain." >&2
    echo "Import your signing certificate into Keychain Access, then rerun this command." >&2
    return 1
  fi

  if [[ -n "$team_id" ]]; then
    team_id="$(macos_normalize_team_id "$team_id")"
    IFS=$'\n' filtered_identities=($(macos_filter_identities_by_team_id "$team_id" "${identities[@]}"))

    if [[ "${#filtered_identities[@]}" -gt 0 ]]; then
      identities=("${filtered_identities[@]}")
    else
      echo "No installed Developer ID Application identity matches Apple Team ID $team_id." >&2
      echo "Import the certificate for that team or choose a different Team ID." >&2
      return 1
    fi
  fi

  local selected_identity=""

  if macos_is_interactive; then
    selected_identity="$(macos_choose_identity_interactively "$saved_identity" "${identities[@]}")"
  elif [[ -n "$saved_identity" ]] && macos_identity_exists "$saved_identity" "${identities[@]}"; then
    selected_identity="$saved_identity"
  elif [[ "${#identities[@]}" -eq 1 ]]; then
    selected_identity="${identities[0]}"
  else
    echo "Multiple signing identities are installed." >&2
    echo "Set APPLE_SIGN_IDENTITY explicitly or rerun this command in an interactive terminal." >&2
    return 1
  fi

  macos_save_signing_identity "$selected_identity"
  printf '%s\n' "$selected_identity"
}

macos_notary_profile_is_valid() {
  local profile="$1"
  local keychain="${APPLE_KEYCHAIN_PATH:-}"
  local -a args

  args=(history --keychain-profile "$profile" --output-format json --no-progress)
  if [[ -n "$keychain" ]]; then
    args+=(--keychain "$keychain")
  fi

  xcrun notarytool "${args[@]}" >/dev/null 2>&1
}

macos_load_saved_notary_profile() {
  macos_state_saved_notary_profile
}

macos_save_notary_profile() {
  local profile="$1"
  local identity
  local team_id
  local apple_id
  identity="$(macos_state_saved_sign_identity)"
  team_id="$(macos_state_saved_team_id)"
  apple_id="$(macos_state_saved_apple_id)"
  macos_write_state_file "$identity" "$profile" "$team_id" "$apple_id"
}

macos_load_saved_apple_id() {
  macos_state_saved_apple_id
}

macos_apple_id_is_valid() {
  local apple_id="${1:-}"
  [[ "$apple_id" =~ ^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$ ]]
}

macos_save_apple_id() {
  local apple_id="$1"
  local identity
  local profile
  local team_id

  identity="$(macos_state_saved_sign_identity)"
  profile="$(macos_state_saved_notary_profile)"
  team_id="$(macos_state_saved_team_id)"
  macos_write_state_file "$identity" "$profile" "$team_id" "$apple_id"
}

macos_prompt_apple_id() {
  local initial_value="${1:-}"
  local apple_id=""

  while true; do
    if [[ -n "$initial_value" ]]; then
      apple_id="$(macos_tty_prompt_read "Developer Apple ID email [$initial_value]: ")" || return 1
      apple_id="${apple_id:-$initial_value}"
    else
      apple_id="$(macos_tty_prompt_read "Developer Apple ID email: ")" || return 1
    fi

    apple_id="${apple_id#"${apple_id%%[![:space:]]*}"}"
    apple_id="${apple_id%"${apple_id##*[![:space:]]}"}"

    if macos_apple_id_is_valid "$apple_id"; then
      printf '%s\n' "$apple_id"
      return 0
    fi

    macos_tty_print "Enter the Apple ID email address, for example name@example.com."
  done
}

macos_resolve_apple_id() {
  local explicit_apple_id="${APPLE_ID:-${APPLE_DEVELOPER_ID:-}}"
  local saved_apple_id
  saved_apple_id="$(macos_load_saved_apple_id)"

  if [[ -n "$explicit_apple_id" ]]; then
    if macos_apple_id_is_valid "$explicit_apple_id"; then
      macos_save_apple_id "$explicit_apple_id"
      printf '%s\n' "$explicit_apple_id"
      return 0
    fi

    echo "APPLE_ID was provided but is not a valid email address." >&2
    return 1
  fi

  if [[ -n "$saved_apple_id" ]]; then
    if ! macos_is_interactive; then
      printf '%s\n' "$saved_apple_id"
      return 0
    fi

    macos_tty_print "Remembered Developer Apple ID:"
    macos_tty_print "  $saved_apple_id"

    if macos_prompt_yes_no "Use the remembered Developer Apple ID?" "yes"; then
      printf '%s\n' "$saved_apple_id"
      return 0
    fi
  fi

  if ! macos_is_interactive; then
    echo "No Apple ID email is configured." >&2
    echo "Set APPLE_ID explicitly or rerun this command in an interactive terminal." >&2
    return 1
  fi

  local selected_apple_id=""
  selected_apple_id="$(macos_prompt_apple_id "$saved_apple_id")"
  macos_save_apple_id "$selected_apple_id"
  printf '%s\n' "$selected_apple_id"
}

macos_prompt_notary_profile() {
  local prompt="$1"
  local initial_value="${2:-}"
  local profile=""

  while true; do
    if [[ -n "$initial_value" ]]; then
      profile="$(macos_tty_prompt_read "$prompt [$initial_value]: ")" || return 1
      profile="${profile:-$initial_value}"
    else
      profile="$(macos_tty_prompt_read "$prompt: ")" || return 1
    fi

    profile="${profile#"${profile%%[![:space:]]*}"}"
    profile="${profile%"${profile##*[![:space:]]}"}"

    if [[ -n "$profile" ]]; then
      printf '%s\n' "$profile"
      return 0
    fi

    macos_tty_print "Please enter a non-empty notarytool keychain profile name."
  done
}

macos_resolve_notary_profile() {
  local explicit_profile="${APPLE_KEYCHAIN_PROFILE:-${RELYY_NOTARY_PROFILE:-}}"
  local saved_profile
  saved_profile="$(macos_load_saved_notary_profile)"

  if [[ -n "$explicit_profile" ]]; then
    if macos_notary_profile_is_valid "$explicit_profile"; then
      macos_save_notary_profile "$explicit_profile"
      printf '%s\n' "$explicit_profile"
      return 0
    fi

    echo "The configured notarytool keychain profile is invalid or unavailable: $explicit_profile" >&2
    return 1
  fi

  if [[ -n "$saved_profile" ]] && macos_notary_profile_is_valid "$saved_profile"; then
    if ! macos_is_interactive || macos_prompt_yes_no "Use the remembered notarytool profile \"$saved_profile\"?" "yes"; then
      printf '%s\n' "$saved_profile"
      return 0
    fi
  fi

  if ! macos_is_interactive; then
    echo "No valid remembered notarytool keychain profile is available." >&2
    echo "Set APPLE_KEYCHAIN_PROFILE explicitly or rerun this command in an interactive terminal." >&2
    return 1
  fi

  local attempt=""
  if [[ -n "$saved_profile" ]]; then
    attempt="$saved_profile"
  fi

  while true; do
    local selected_profile
    selected_profile="$(macos_prompt_notary_profile "Enter a notarytool keychain profile name" "$attempt")"

    if macos_notary_profile_is_valid "$selected_profile"; then
      macos_save_notary_profile "$selected_profile"
      printf '%s\n' "$selected_profile"
      return 0
    fi

    macos_tty_print "That notarytool keychain profile could not be validated."
    macos_tty_print "Create or update it with:"
    macos_tty_print "  xcrun notarytool store-credentials \"$selected_profile\" --validate"
    attempt="$selected_profile"
  done
}
