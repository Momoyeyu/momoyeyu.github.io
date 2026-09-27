#!/usr/bin/env bash
set -euo pipefail

warn() { printf '[WARN] %s\n' "$*" >&2; }

# raw.githubusercontent.com (and sometimes github.com/nodejs.org) hangs instead
# of failing on networks where it is blocked — try each source in order with a
# bounded wait instead of stalling forever.
fetch_url() {
  local url
  for url in "$@"; do
    if curl -fsSL --connect-timeout 8 --max-time 90 "$url" 2>/dev/null; then
      return 0
    fi
    warn "fetch failed, trying next source: $url"
  done
  return 1
}

# git_clone_nvm <url> [<mirror-url> ...] — clones into $NVM_DIR at $NVM_VER.
# git's lowSpeed* knobs bound each attempt (portable — no `timeout` on macOS).
git_clone_nvm() {
  local url
  for url in "$@"; do
    rm -rf "$NVM_DIR"
    if git -c http.lowSpeedLimit=1000 -c http.lowSpeedTime=30 clone --depth 1 --branch "$NVM_VER" "$url" "$NVM_DIR"; then
      return 0
    fi
    warn "clone failed, trying next source: $url"
  done
  return 1
}

export NVM_DIR="$HOME/.nvm"
NVM_VER=v0.40.1
if [ ! -s "$NVM_DIR/nvm.sh" ]; then
  installer="$(fetch_url \
    "https://raw.githubusercontent.com/nvm-sh/nvm/$NVM_VER/install.sh" \
    "https://cdn.jsdelivr.net/gh/nvm-sh/nvm@$NVM_VER/install.sh" \
    "https://fastly.jsdelivr.net/gh/nvm-sh/nvm@$NVM_VER/install.sh" \
    "https://gitee.com/mirrors/nvm/raw/$NVM_VER/install.sh")" || installer=""
  if [ -n "$installer" ]; then
    # </dev/null: this script is usually itself piped into bash, so the
    # installer must never read (and swallow) the rest of it from stdin.
    bash -c "$installer" </dev/null || true
  fi
fi
if [ ! -s "$NVM_DIR/nvm.sh" ]; then
  # Fallback: the nvm repo itself is a valid install (nvm.sh lives at its root).
  echo "nvm install.sh unavailable; falling back to git clone." >&2
  git_clone_nvm \
    https://github.com/nvm-sh/nvm.git \
    https://gitee.com/mirrors/nvm.git || { echo "nvm install failed on all sources." >&2; exit 1; }
  # install.sh normally appends the sourcing lines to ~/.zshrc — replicate for
  # the clone path (idempotent).
  ZSHRC="$HOME/.zshrc"
  touch "$ZSHRC"
  grep -q 'NVM_DIR' "$ZSHRC" || cat >> "$ZSHRC" <<'EOF'
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
EOF
fi
. "$NVM_DIR/nvm.sh"

# nodejs.org is also unreachable on some networks — retry once via the
# npmmirror node mirror if the default download fails.
nvm install 22 || NVM_NODEJS_ORG_MIRROR=https://npmmirror.com/mirrors/node nvm install 22
nvm use 22

corepack enable
corepack prepare pnpm@latest --activate

# pnpm's global bin dir is OS-dependent, so don't hardcode one platform's path:
#   $PNPM_HOME/bin when PNPM_HOME is set, otherwise
#   macOS: ~/Library/pnpm/bin    Linux: ~/.local/share/pnpm/bin
# (verified to match `pnpm bin -g` in both configurations)
if [ -z "${PNPM_HOME:-}" ]; then
  case "$(uname -s)" in
    Darwin) PNPM_HOME="$HOME/Library/pnpm" ;;
    *)      PNPM_HOME="$HOME/.local/share/pnpm" ;;
  esac
fi
PNPM_BIN="$PNPM_HOME/bin"
export PNPM_HOME

# Must be in PATH *before* `pnpm install -g`: on a fresh machine pnpm refuses
# with ERR_PNPM_GLOBAL_BIN_DIR_NOT_IN_PATH otherwise.
case ":$PATH:" in
  *":$PNPM_BIN:"*) ;;
  *) export PATH="$PATH:$PNPM_BIN" ;;
esac

pnpm config set dangerouslyAllowAllBuilds true
# npmjs registry may be unreachable; retry once via npmmirror.
pnpm install -g @deepseek-ai/dsh @deepseek-harness-tui/dsh-tui || \
  pnpm install -g --registry=https://registry.npmmirror.com @deepseek-ai/dsh @deepseek-harness-tui/dsh-tui

ZSHRC="$HOME/.zshrc"
touch "$ZSHRC"
grep -qF "$PNPM_BIN" "$ZSHRC" 2>/dev/null || printf 'export PATH="$PATH:%s"\n' "$PNPM_BIN" >> "$ZSHRC"

ENV_FILE="$HOME/.dsh/.env"
mkdir -p "$HOME/.dsh"
if [ -f "$ENV_FILE" ] && grep -qE '^DEEPSEEK_API_KEY=.+' "$ENV_FILE"; then
  echo "DEEPSEEK_API_KEY already set in $ENV_FILE, skipping."
else
  # Read from /dev/tty: when this script is piped (`curl ... | bash`), stdin is
  # the script itself, so a plain `read` would swallow the rest of the script.
  while :; do
    printf 'Enter DEEPSEEK_API_KEY: '
    if ! { read -r key < /dev/tty; } 2>/dev/null; then
      echo >&2
      echo "Cannot prompt: no usable terminal (/dev/tty)." >&2
      echo "Write DEEPSEEK_API_KEY=<your-key> into $ENV_FILE and re-run." >&2
      exit 1
    fi
    [ -n "$key" ] && break
    echo "Empty input, please try again."
  done
  if [ -f "$ENV_FILE" ]; then
    grep -v '^DEEPSEEK_API_KEY=' "$ENV_FILE" > "$ENV_FILE.tmp" || true
    mv "$ENV_FILE.tmp" "$ENV_FILE"
  fi
  echo "DEEPSEEK_API_KEY=$key" >> "$ENV_FILE"
fi

hash -r
if command -v dsh-tui >/dev/null 2>&1; then
  echo "dsh-tui version: $(dsh-tui --version 2>/dev/null || echo unknown)"
else
  echo "dsh-tui was installed but is not on PATH yet." >&2
  echo "It lives in $PNPM_BIN - open a new terminal, or run:" >&2
  echo "  export PATH=\"\$PATH:$PNPM_BIN\"" >&2
  exit 1
fi
