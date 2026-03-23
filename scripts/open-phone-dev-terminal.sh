#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_FILE="${ATRIA_PHONE_LOG:-/tmp/atria-phone-dev.log}"
SHELL_PATH="${SHELL:-/bin/zsh}"

if ! command -v osascript >/dev/null 2>&1; then
  echo "osascript is required to open Terminal for phone testing."
  exit 1
fi

if command -v brew >/dev/null 2>&1; then
  NODE22_PREFIX="$(brew --prefix node@22 2>/dev/null || true)"
  if [[ -n "${NODE22_PREFIX}" && -d "${NODE22_PREFIX}/bin" ]]; then
    export PATH="${NODE22_PREFIX}/bin:${PATH}"
  fi
fi

printf -v TERMINAL_COMMAND \
  'cd %q; export PATH=%q; npm run dev:phone 2>&1 | tee %q; exec %q -l' \
  "${ROOT_DIR}" \
  "${PATH}" \
  "${LOG_FILE}" \
  "${SHELL_PATH}"

osascript - "${TERMINAL_COMMAND}" <<'APPLESCRIPT'
on run argv
  set bootCommand to item 1 of argv
  tell application "Terminal"
    do script bootCommand
  end tell
end run
APPLESCRIPT
