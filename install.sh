#!/usr/bin/env bash
#
# pyconfig — reproduce a Pi coding-agent setup on a new machine.
#
# Usage:
#   ./install.sh            # install config into ~/.pi/agent
#   PI_CODING_AGENT_DIR=... ./install.sh
#
# The script is idempotent. Existing files are backed up to
# <agent-dir>/pyconfig-backup-<timestamp>/ before being overwritten.

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AGENT_DIR="${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_DIR="$AGENT_DIR/pyconfig-backup-$STAMP"

info()  { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
warn()  { printf '\033[1;33m[!]\033[0m %s\n' "$*"; }
error() { printf '\033[1;31m[x]\033[0m %s\n' "$*" >&2; }

# ---------------------------------------------------------------------------
# 1. Check prerequisites
# ---------------------------------------------------------------------------
info "Checking prerequisites"
missing=0
for bin in node npm git; do
	if command -v "$bin" >/dev/null 2>&1; then
		printf '  %-8s %s\n' "$bin" "$("$bin" --version 2>/dev/null | head -n1)"
	else
		warn "missing: $bin"
		missing=1
	fi
done
if ! command -v docker >/dev/null 2>&1; then
	warn "missing: docker (needed only for the GitHub MCP server)"
fi
if ! command -v ffmpeg >/dev/null 2>&1; then
	warn "missing: ffmpeg (needed only for microphone/STT capture)"
fi
if [[ "$missing" -ne 0 ]]; then
	error "Install the required tools (Node.js >= 22.19, npm, git) and re-run."
	exit 1
fi

# ---------------------------------------------------------------------------
# 2. Install Pi
# ---------------------------------------------------------------------------
if command -v pi >/dev/null 2>&1; then
	info "Pi already installed: $(pi --version 2>/dev/null || echo '?')"
else
	info "Installing Pi (npm global)"
	npm install -g --ignore-scripts @earendil-works/pi-coding-agent
fi

# ---------------------------------------------------------------------------
# 3. Back up and copy configuration
# ---------------------------------------------------------------------------
info "Installing configuration into $AGENT_DIR"
mkdir -p "$AGENT_DIR/agents" "$AGENT_DIR/extensions"
backup() {
	local target="$1"
	if [[ -e "$target" ]]; then
		mkdir -p "$BACKUP_DIR"
		cp -R "$target" "$BACKUP_DIR/" 2>/dev/null || true
	fi
}

for f in settings.json mcp.json stt.json; do
	backup "$AGENT_DIR/$f"
done
backup "$AGENT_DIR/agents"
backup "$AGENT_DIR/extensions"

cp "$REPO_DIR/config/settings.json" "$AGENT_DIR/settings.json"
cp "$REPO_DIR/config/mcp.json"      "$AGENT_DIR/mcp.json"
cp "$REPO_DIR/config/stt.json"      "$AGENT_DIR/stt.json"
cp -R "$REPO_DIR/config/agents/."    "$AGENT_DIR/agents/"
cp -R "$REPO_DIR/config/extensions/." "$AGENT_DIR/extensions/"

if [[ -d "$BACKUP_DIR" ]]; then
	info "Previous config backed up to $BACKUP_DIR"
fi

# ---------------------------------------------------------------------------
# 4. Install extension dependencies
# ---------------------------------------------------------------------------
for ext in bash-guard web-fetch; do
	if [[ -f "$AGENT_DIR/extensions/$ext/package.json" ]]; then
		info "Installing dependencies for extension: $ext"
		( cd "$AGENT_DIR/extensions/$ext" && npm ci --no-audit --no-fund )
	fi
done

# ---------------------------------------------------------------------------
# 5. Install Pi packages declared in settings.json
# ---------------------------------------------------------------------------
info "Installing Pi packages"
pi install npm:pi-voice-stt
pi install git:github.com/amosblomqvist/pi-interactive-subagents
pi update --extensions >/dev/null 2>&1 || true

# ---------------------------------------------------------------------------
# 6. Secrets
# ---------------------------------------------------------------------------
SECRETS_FILE="$AGENT_DIR/secrets.env"
if [[ ! -f "$SECRETS_FILE" ]]; then
	cp "$REPO_DIR/config/secrets.env.example" "$SECRETS_FILE"
	chmod 600 "$SECRETS_FILE"
	info "Created $SECRETS_FILE (chmod 600) — fill in your API keys."
else
	info "Keeping existing $SECRETS_FILE"
fi

# Make interactive shells load the secrets file.
MARKER="# pyconfig: load Pi secrets"
for rc in "$HOME/.bashrc" "$HOME/.zshrc"; do
	[[ -e "$rc" || "$rc" == "$HOME/.bashrc" ]] || continue
	if [[ -f "$rc" ]] && grep -qF "$MARKER" "$rc"; then
		continue
	fi
	{
		printf '\n%s\n' "$MARKER"
		printf '[ -f "%s" ] && set -a && . "%s" && set +a\n' "$SECRETS_FILE" "$SECRETS_FILE"
	} >> "$rc"
	info "Added secrets loader to $rc"
done

if command -v docker >/dev/null 2>&1; then
	info "Pulling GitHub MCP server image"
	docker pull ghcr.io/github/github-mcp-server >/dev/null 2>&1 || \
		warn "Could not pull ghcr.io/github/github-mcp-server (run it manually later)"
fi

cat <<EOF

$(info "Done.")

Next steps:
  1. Fill in your API keys:   \$EDITOR $SECRETS_FILE
  2. Open a new shell (or run: set -a && . $SECRETS_FILE && set +a)
  3. Optional OAuth logins:   pi auth login openrouter
                              pi auth login github-copilot
                              pi mcp login notion
  4. Start Pi:                pi

EOF
