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

grep -q 'Library/pnpm/bin' ~/.zshrc 2>/dev/null || echo 'export PATH="$PATH:$HOME/Library/pnpm/bin"' >> ~/.zshrc
case ":$PATH:" in
  *":$HOME/Library/pnpm/bin:"*) ;;
  *) export PATH="$PATH:$HOME/Library/pnpm/bin" ;;
esac

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
which dsh-tui && dsh-tui --version
