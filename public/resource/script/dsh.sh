#!/usr/bin/env bash
set -euo pipefail

export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] || curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
. "$NVM_DIR/nvm.sh"

nvm install 22
nvm use 22

corepack enable
corepack prepare pnpm@latest --activate

pnpm config set dangerouslyAllowAllBuilds true
pnpm install -g @deepseek-ai/dsh @deepseek-harness-tui/dsh-tui

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

case ":$PATH:" in
  *":$PNPM_BIN:"*) ;;
  *) export PATH="$PATH:$PNPM_BIN" ;;
esac

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
