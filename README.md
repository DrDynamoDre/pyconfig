# pyconfig

Reproducible [Pi](https://pi.dev) coding-agent configuration.

Clone this repo on a new machine and run one script to get the same Pi setup:
default provider/model, MCP servers, extensions, and sub-agents.

> **No secrets are committed.** All credentials are read from environment
> variables (see [Secrets](#secrets)). The repository is safe to make public.

## What you get

| Piece | Details |
|---|---|
| Default provider / model | `openrouter` / `deepseek/deepseek-v4.1-flash` |
| Pi packages | `pi-voice-stt` (speech-to-text), `pi-interactive-subagents` |
| Extensions | `ask_user_question`, `bash-guard`, `web_fetch`, `web_search` (Tavily) |
| Sub-agents | `scout` (recon), `researcher` (web research), `worker` (general coding) |
| MCP servers | `playwright` (npx), `github` (Docker), `notion` (OAuth) |
| STT | Deepgram `nova-3` via `pi-voice-stt` |

## Prerequisites

- **Node.js >= 22.19** and npm
- **git**
- **Docker** — only for the GitHub MCP server
- **ffmpeg** — only for microphone / STT capture

## Install

```bash
git clone https://github.com/<your-user>/pyconfig.git
cd pyconfig
./install.sh
```

The installer:

1. Checks prerequisites and installs Pi (`npm i -g @earendil-works/pi-coding-agent`) if missing.
2. Backs up any existing config, then copies `config/` into `~/.pi/agent/`.
3. Runs `npm ci` for the `bash-guard` and `web-fetch` extensions.
4. Installs the Pi packages from `settings.json`.
5. Creates `~/.pi/agent/secrets.env` (mode `600`) and sources it from your shell rc.
6. Pulls the GitHub MCP server Docker image.

Override the target directory with `PI_CODING_AGENT_DIR=/path ./install.sh`.

### Manual install

If you prefer to do it by hand, replicate the installer steps:

```bash
mkdir -p ~/.pi/agent
cp -R config/agents config/extensions config/settings.json config/mcp.json config/stt.json ~/.pi/agent/
( cd ~/.pi/agent/extensions/bash-guard && npm ci )
( cd ~/.pi/agent/extensions/web-fetch  && npm ci )
pi install npm:pi-voice-stt
pi install git:github.com/amosblomqvist/pi-interactive-subagents
```

## Secrets

Nothing sensitive lives in this repo. On the new machine, edit
`~/.pi/agent/secrets.env` and fill in the values, then open a new shell:

| Variable | Used by | Where to get it |
|---|---|---|
| `OPENROUTER_API_KEY` | default provider | https://openrouter.ai/keys |
| `DEEPGRAM_API_KEY` | `pi-voice-stt` | https://console.deepgram.com/ |
| `TAVILY_API_KEY` | `web_search` extension | https://app.tavily.com/ |
| `GITHUB_PERSONAL_ACCESS_TOKEN` | `github` MCP server | https://github.com/settings/tokens (needs `repo` scope to create repos) |
| `COPILOT_GITHUB_TOKEN` | optional Copilot provider | `pi auth login github-copilot` instead |

Alternatively use Pi's native login flows (stored in `~/.pi/agent/auth.json`,
which is also gitignored):

```bash
pi auth login openrouter
pi auth login github-copilot
pi mcp login notion        # Notion MCP is OAuth-based
```

`config/secrets.env.example` is the template that `install.sh` copies to
`~/.pi/agent/secrets.env`.

## Repository layout

```text
pyconfig/
├── install.sh                         # one-shot installer
├── config/                            # copied verbatim into ~/.pi/agent/
│   ├── settings.json                  # provider, model, packages
│   ├── mcp.json                       # MCP server definitions
│   ├── stt.json                       # Deepgram config (uses DEEPGRAM_API_KEY)
│   ├── secrets.env.example            # secrets template
│   ├── agents/                        # scout.md, researcher.md, worker.md
│   └── extensions/
│       ├── ask-user-question.ts
│       ├── bash-guard/                # /bash-guard command
│       ├── web-fetch/                 # web_fetch tool
│       └── web-search/                # web_search tool (Tavily)
└── .gitignore
```

## Extensions

- **ask-user-question** — interactive multiple-choice prompt tool.
- **bash-guard** — blocks risky shell patterns; `/bash-guard` command.
- **web-fetch** — fetch a URL and convert it to markdown (HTML and PDF).
- **web-search** — Tavily-backed web search (`TAVILY_API_KEY`).

## Sub-agents

- **scout** — read-only codebase recon (`claude-haiku-5.5`).
- **researcher** — sourced web research (`claude-sonnet-5.5`).
- **worker** — general coding; can dispatch scout/researcher (`gpt-6-luna`).

## Updating

```bash
pi update --all          # update Pi + packages
pi update --extensions   # packages only
```

## Security notes

- `~/.pi/agent/secrets.env`, `auth.json`, `mcp-auth.json`, `models-store.json`,
  and `~/.pi/agent/extensions/web-search/auth.json` are **gitignored**.
- Before committing anything, verify no secrets slipped in:
  ```bash
  git grep -nE 'sk-or-|tvly-|ghp_|github_pat_|-----BEGIN'
  ```
- Never force-add an ignored file.

## Uninstall

```bash
npm uninstall -g @earendil-works/pi-coding-agent
rm -rf ~/.pi/agent        # deletes config, secrets, and sessions
```
