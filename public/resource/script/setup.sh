#!/usr/bin/env bash
set -euo pipefail

info() { printf '\033[1;34m[INFO]\033[0m %s\n' "$*"; }
ok()   { printf '\033[1;32m[ OK ]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[WARN]\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m[FAIL]\033[0m %s\n' "$*" >&2; exit 1; }

# This script is normally piped (`curl -fsSL ... | bash`), so stdin IS the script
# itself — a plain `read` would swallow the rest of it. Always prompt via /dev/tty.
# Usage: read_tty "<prompt>" ["<default>"]  ->  sets REPLY_TTY, non-zero if no tty.
REPLY_TTY=""
read_tty() {
  local prompt="$1" default="${2:-}"
  REPLY_TTY=""
  if ! { printf '%s' "$prompt" >/dev/tty && IFS= read -r REPLY_TTY < /dev/tty; } 2>/dev/null; then
    return 1
  fi
  [[ -n "$REPLY_TTY" ]] || REPLY_TTY="$default"
  return 0
}

is_email() { [[ "$1" == *"@"*"."* && "$1" != *[[:space:]]* ]]; }

: "${USER:=$(id -un)}"
case "$(uname -s)" in
  Darwin) OS_TYPE=macos ;;
  Linux)  OS_TYPE=linux ;;
  *)      die "Unsupported OS: $(uname -s)" ;;
esac
info "Detected OS: $OS_TYPE"

if [[ $EUID -eq 0 ]]; then SUDO=""
elif command -v sudo >/dev/null 2>&1; then SUDO="sudo"
else SUDO=""; warn "No root/sudo; system installs may fail."
fi
run_priv() { if [[ -n "$SUDO" ]]; then "$SUDO" "$@"; else "$@"; fi; }

if [[ "$OS_TYPE" == linux ]]; then
  command -v apt-get >/dev/null 2>&1 || die "Linux requires apt-get"
fi

install_pkgs() {
  [[ $# -gt 0 ]] || return 0
  if [[ "$OS_TYPE" == macos ]]; then brew install "$@"
  else run_priv apt-get install -y "$@"; fi
}

if [[ "$OS_TYPE" == macos ]]; then
  export PATH="/usr/local/bin:/opt/homebrew/bin:$PATH"
  hash -r 2>/dev/null || true
  if ! command -v brew >/dev/null 2>&1; then
    info "Installing Homebrew ..."
    NONINTERACTIVE=1 /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)" || die "Homebrew installation failed."
  fi
  for brew_bin in /opt/homebrew/bin/brew /usr/local/bin/brew; do
    if [[ -x "$brew_bin" ]]; then eval "$("$brew_bin" shellenv)"; break; fi
  done
  ok "Homebrew ready at $(brew --prefix)"
  if xcode-select -p >/dev/null 2>&1 && [[ -d "$(xcode-select -p 2>/dev/null || echo /nonexistent)" ]]; then
    ok "Xcode CLT already installed."
  else
    info "Installing Xcode CLT ..."
    xcode-select --install >/dev/null 2>&1 || true
    warn "Finish Xcode CLT install dialog, then re-run."
  fi
else
  info "Using apt to install base packages ..."
  run_priv apt-get update -y
  install_pkgs ca-certificates curl file git zsh build-essential
  ok "apt packages installed."
fi

command -v git >/dev/null 2>&1 || die "git not found. On macOS finish Xcode CLT and re-run."

if [[ ! -d "$HOME/.oh-my-zsh" ]]; then
  info "Installing oh-my-zsh ..."
  RUNZSH=no CHSH=no KEEP_ZSHRC=yes sh -c "$(curl -fsSL https://raw.githubusercontent.com/ohmyzsh/ohmyzsh/master/tools/install.sh)" || warn "oh-my-zsh installer returned non-zero, continue."
  ok "oh-my-zsh installed."
else
  ok "oh-my-zsh already installed."
fi

export ZSH="${ZSH:-$HOME/.oh-my-zsh}"
export ZSH_CUSTOM="${ZSH_CUSTOM:-$ZSH/custom}"
mkdir -p "$ZSH_CUSTOM/plugins"

install_zsh_plugin() {
  local name="$1" url="$2"
  local dest="$ZSH_CUSTOM/plugins/$name"
  if [[ -d "$dest" ]]; then ok "Plugin already installed: $name"
  else info "Installing zsh plugin: $name"; git clone --depth 1 "$url" "$dest"; ok "Plugin installed: $name"; fi
}

install_zsh_plugin fast-syntax-highlighting https://github.com/zdharma-continuum/fast-syntax-highlighting.git
install_zsh_plugin zsh-autosuggestions https://github.com/zsh-users/zsh-autosuggestions.git

update_zshrc_plugins() {
  local zshrc="$HOME/.zshrc"
  [[ -f "$zshrc" ]] || touch "$zshrc"
  local required="git fast-syntax-highlighting zsh-autosuggestions"
  local existing=""
  if grep -qE '^[[:space:]]*plugins=\(' "$zshrc"; then
    existing=$(awk '
      BEGIN { in_block=0; out="" }
      /^[[:space:]]*plugins=\(/ {
        in_block=1; s=$0; sub(/^[^(]*\(/,"",s)
        if (s ~ /\)/) { sub(/\).*$/,"",s); in_block=0 }
        out=out" "s; next
      }
      in_block { s=$0; if (s ~ /\)/) { sub(/\).*$/,"",s); in_block=0 } out=out" "s }
      END { gsub(/[ \t\n]+/," ",out); sub(/^ +/,"",out); sub(/ +$/,"",out); print out }
    ' "$zshrc")
  fi
  local merged="$existing"
  local r
  for r in $required; do
    case " $merged " in *" $r "*) ;; *) merged="$merged $r" ;; esac
  done
  merged="${merged# }"
  local tmp=$(mktemp)
  if grep -qE '^[[:space:]]*plugins=\(' "$zshrc"; then
    awk -v plist="$merged" '
      BEGIN { in_block=0; replaced=0; n=split(plist,p," ") }
      function emit() { print "plugins=("; for (i=1;i<=n;i++) print "  " p[i]; print ")" }
      /^[[:space:]]*plugins=\(/ { in_block=1; if ($0 ~ /\)/) in_block=0; if (in_block==0) { if (!replaced) { emit(); replaced=1 } }; next }
      in_block { if ($0 ~ /\)/) { in_block=0; if (!replaced) { emit(); replaced=1 } }; next }
      { print }
      END { if (!replaced) emit() }
    ' "$zshrc" > "$tmp"
    mv "$tmp" "$zshrc"
  else
    local src_line=$(grep -n 'oh-my-zsh.sh' "$zshrc" 2>/dev/null | head -n1 | cut -d: -f1) || true
    if [[ -n "${src_line:-}" ]]; then
      head -n "$((src_line - 1))" "$zshrc" > "$tmp"
      { echo "plugins=("; for r in $merged; do echo "  $r"; done; echo ")"; } >> "$tmp"
      tail -n "+${src_line}" "$zshrc" >> "$tmp"
      mv "$tmp" "$zshrc"
    else
      { echo ""; echo "plugins=("; for r in $merged; do echo "  $r"; done; echo ")"; } >> "$zshrc"
      rm -f "$tmp"
    fi
  fi
  ok "Updated ~/.zshrc plugins: $merged"
}
update_zshrc_plugins

add_zsh_aliases() {
  local zshrc="$HOME/.zshrc"
  [[ -f "$zshrc" ]] || touch "$zshrc"
  local marker=">>> setup.sh aliases >>>"
  if grep -qF "$marker" "$zshrc"; then ok "zsh aliases already present."; return; fi
  cat >> "$zshrc" <<'EOF'

# >>> setup.sh aliases >>>
alias c='clear'
alias ll='ls -l'
alias la='ls -a'
alias zshcfg='vim ~/.zshrc'
alias zshsrc='source ~/.zshrc'
alias hostcfg='sudo vim /etc/hosts'
# <<< setup.sh aliases <<<
EOF
  ok "Added zsh aliases to ~/.zshrc"
}
add_zsh_aliases

setup_git_config() {
  local cur_name cur_email name email
  cur_name="$(git config --global --get user.name 2>/dev/null || true)"
  cur_email="$(git config --global --get user.email 2>/dev/null || true)"

  if [[ -n "$cur_name" && -n "$cur_email" ]]; then
    ok "Existing git identity: $cur_name <$cur_email>"
    info "Press Enter to keep it, or type a new value."
  else
    info "git needs a commit identity (it will be the author of your commits)."
  fi

  # Defaults always come from whatever is already configured, so pressing Enter
  # never clobbers an existing value — re-running the script is a no-op.
  name="${cur_name:-${USER:-}}"
  while :; do
    if ! read_tty "  user.name  [${name}]: " "$name"; then break; fi
    name="$REPLY_TTY"
    if [[ -n "$name" ]]; then break; fi
    warn "user.name cannot be empty."
  done

  email="$cur_email"
  while :; do
    if ! read_tty "  user.email [${email}]: " "$email"; then break; fi
    email="$REPLY_TTY"
    if [[ -z "$email" ]]; then continue; fi
    if is_email "$email"; then break; fi
    warn "That doesn't look like an email address, try again."
  done

  if [[ -n "$name" && -n "$email" ]] && is_email "$email"; then
    git config --global user.name "$name"
    git config --global user.email "$email"
    ok "Configured git identity: $name <$email>"
  else
    warn "git identity not set (no usable terminal?). Set it later with:"
    warn "  git config --global user.name  \"Your Name\""
    warn "  git config --global user.email \"you@example.com\""
  fi

  git config --global alias.st status
  git config --global alias.ci commit
  git config --global alias.co checkout
  git config --global alias.br branch
  git config --global alias.df diff
  git config --global alias.lg log
  ok "Configured git aliases in ~/.gitconfig"
}
setup_git_config

setup_zsh_prompt() {
  local zshrc="$HOME/.zshrc"
  [[ -f "$zshrc" ]] || touch "$zshrc"
  local marker=">>> setup.sh prompt >>>"
  if grep -qF "$marker" "$zshrc"; then ok "zsh PROMPT already configured."; return; fi
  cat >> "$zshrc" <<'EOF'

# >>> setup.sh prompt >>>
PROMPT='%{$fg_bold[magenta]%}%n@%m%{$reset_color%} %(?:%{$fg_bold[green]%}➜ :%{$fg_bold[red]%}➜ ) %{$fg[cyan]%}%c%{$reset_color%} $(git_prompt_info)'
# <<< setup.sh prompt <<<
EOF
  ok "Configured zsh PROMPT in ~/.zshrc"
}
setup_zsh_prompt

get_login_shell() {
  if [[ "$OS_TYPE" == macos ]]; then dscl . -read "/Users/$USER" UserShell 2>/dev/null | awk '{print $2}'
  else
    if command -v getent >/dev/null 2>&1; then getent passwd "$USER" 2>/dev/null | cut -d: -f7
    else awk -F: -v u="$USER" '$1==u{print $7}' /etc/passwd; fi
  fi
}

set_default_shell() {
  local zsh_path
  zsh_path="$(command -v zsh 2>/dev/null || true)"
  if [[ -z "$zsh_path" || ! -x "$zsh_path" ]]; then warn "zsh not found, skip changing default shell."; return; fi
  if [[ "$OS_TYPE" == linux ]]; then
    if [[ ! -r /etc/shells ]] || ! grep -qx "$zsh_path" /etc/shells 2>/dev/null; then
      info "Adding $zsh_path to /etc/shells ..."
      echo "$zsh_path" | run_priv tee -a /etc/shells >/dev/null
    fi
  fi
  local current_shell
  current_shell="$(get_login_shell || true)"
  if [[ "$current_shell" == "$zsh_path" ]]; then ok "Default login shell is already zsh ($zsh_path)."; return; fi
  info "Changing default login shell to $zsh_path ..."
  local rc=0
  if [[ -r /dev/tty ]]; then chsh -s "$zsh_path" </dev/tty || rc=$?
  else chsh -s "$zsh_path" </dev/null || rc=$?; fi
  if [[ $rc -ne 0 && "$OS_TYPE" == linux && -n "$SUDO" ]]; then
    warn "chsh (user) failed (rc=$rc); retrying with sudo ..."
    if [[ -r /dev/tty ]]; then $SUDO chsh -s "$zsh_path" "$USER" </dev/tty || rc=$?
    else $SUDO chsh -s "$zsh_path" "$USER" </dev/null || rc=$?; fi
  fi
  if [[ $rc -eq 0 ]]; then ok "Default login shell is now zsh. New terminal sessions will use it."
  else
    warn "chsh failed (rc=$rc). Run manually: chsh -s $zsh_path"
    if [[ "$OS_TYPE" == macos ]]; then warn "Or: System Settings → Users & Groups → Advanced Options → Login shell"
    else warn "On Linux you may need: sudo chsh -s $zsh_path $USER"; fi
  fi
}
set_default_shell

echo
ok "All done! Open a new terminal (or run: exec zsh -l) to use the new shell & prompt."
