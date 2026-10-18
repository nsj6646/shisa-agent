# Architecture

Navigation map for agents: where each subsystem lives, and what a change usually reaches.
Keep it flow- and responsibility-shaped — no line numbers, no exhaustive file lists.
Update it when a subsystem changes job or a flow changes.

## Layout

| Path | What it is |
|---|---|
| `agent/src/` | Daemon. TypeScript run directly by Node (no build step). Owns `~/.cy-agent/cy.db` (`store.ts`) and `~/.cy-agent/config.json`. Serves `127.0.0.1:47823` (`bus.ts`). |
| `desktop/main.js`, `desktop/preload*.cjs` | Electron main process: windows, IPC handlers, asset protocols; `desktop/src/daemon-host.js` spawns and supervises the bundled daemon. |
| `desktop/src/` | Main-process pure logic. Each file's header comment names its job and callers. |
| `desktop/renderer/` | DOM/UI only. Talks to the main process over IPC. Entry points: `index.html` overlay, `panel.html`, `session.html`, `settings.html`. |
| `desktop/scripts/` | Dev harness: `fake-daemon.mjs`, demo scripts, asset and dist scripts. |
| `docs/contract.md` | HTTP/SSE contract between daemon and app. |
| `assets/characters/` | Character art and `lines.json` (phrase source). `desktop/src/character-lines.js` and `character-clips.js` are generated — never hand-edit. |

## Daemon (`agent/src`)

| Area | Key files | Job |
|---|---|---|
| Entry & bus | `main.ts`, `bus.ts`, `cli.ts` | Entrypoint, local HTTP + SSE server, manual CLI commands |
| Config & status | `config.ts`, `settings.ts`, `status.ts`, `connections.ts` | env > `~/.cy-agent/config.json` > defaults; settings write path; what is connected |
| Brains | `brain.ts`, `providers.ts`, `models.ts`, `chat-models.ts`, `local-mode.ts`, `feature-brain.ts` | Briefing/chat brains; HTTP-only providers (Gemini, OpenAI, Genspark, OpenRouter); model choice |
| Chat & runs | `chat.ts`, `runs.ts`, `followup.ts`, `btw.ts`, `thread-agents.ts`, `attachments.ts`, `run-inbox.ts` | Panel chat, run records, continue, /btw, attachments |
| Coding runs | `coding.ts`, `fixer.ts`, `codex-coder.ts`, `pi-coder.ts` (+`pi-gate.js`), `agent-worktrees.ts`, `worktree-keep.ts`, `git.ts`, `git-mutex.ts`, `gh.ts`, `merge-request.ts`, `auto-merge.ts`, `repo-lock.ts` | Approved fix runs: worktree → coder → tests → local result. Coders: Claude Code, Codex (app-server), pi (RPC subprocess; every tool call goes through the daemon's approval gate) |
| Permissions | `permissions.ts`, `guard.ts`, `bash-readonly.ts` | Tool-permission state machine, hard blocks (secrets, protected branches, `gh pr create`), read-only guard |
| Reactions & copy | `reactions.ts`, `phrases.ts`, `characters.ts`, `character-store.ts`, `voice.ts` | Bubbles/stickers, approval cards, phrase catalog |
| Data | `store.ts`, `todos.ts`, `todo-*.ts`, `dashboard.ts`, `manual-projects.ts`, `profile.ts`, `ctx-tools.ts` | Knowledge graph + todos in SQLite; dashboard and prompt-context snapshots |
| Sources | `connectors.ts`, `ingest/`, `slack/`, `mail-*.ts`, `calendar-*.ts`, `ics.ts`, `mcp.ts`, `mcp-health.ts` | Slack/mail/calendar/issues collection |
| Orchestration | `core.ts`, `actions.ts`, `briefing-sources.ts` | Ties collection → briefing → proposals → approvals → runs |

Subdirectories: `ingest/` (Slack and Claude Code session ingestion), `kg/` (knowledge-graph extract/merge/crawl/refine), `slack/` (Bolt app, blocks), `fixtures/` (test fixtures).

## Fix run (수정 run) flow

The flow most changes touch:

1. A request arrives in chat or the panel (`chat.ts`); work starts only from an approved proposal (`core.ts`, `actions.ts`).
2. `fixer.ts` creates a git worktree, asks the chosen coder (`coding.ts` → Claude Code, `codex-coder.ts`, or `pi-coder.ts`) to change files, runs the tests, then `finishLocal` leaves the changes **uncommitted in the worktree**. The host never commits, pushes, or opens a PR (`permissions.ts` hard-blocks `gh pr create`). For pi, `pi-gate.js` forwards every tool call to `core.approvePiTool` (shell commands always become approval cards; file tools stay inside the worktree).
3. A finished or stopped run keeps its worktree when dirty (`worktree-keep.ts`, `agent-worktrees.ts`).
4. "Continue" (`followup.ts`, `reusableWorktree` in `fixer.ts`) restarts from that kept worktree — no remote branch or PR needed.
5. The app shows progress over SSE (`bus.ts` → `desktop/renderer/session.js`; `runs.ts` for records, `desktop/src/session.js` for the pure logic).

## Companion edits

A user-visible change usually reaches more than one place:

- Copy: `agent/src/phrases.ts` (catalog) → `assets/characters/lines.json` → `node desktop/scripts/sync-character-lines.mjs` → generated `desktop/src/character-lines.js`.
- Dev harness: `desktop/scripts/fake-daemon.mjs`, `demo-data.mjs`, `demo-driver.mjs` must match the contract.
- `docs/contract.md` and `README.md` when routes, settings, or user-facing behavior change.

## Verification

- Full runs: `cd agent && npm test`, `cd desktop && npm test`.
- One file, still isolated: `cd agent && CY_AGENT_HOME=$(mktemp -d) TZ=Asia/Seoul node --test src/<file>.test.ts`; `cd desktop && node --test test/<file>.test.js`.
- `agent/scripts/test.mjs` (behind `agent` `npm test`) is the cross-platform wrapper that sets `TZ` and a fresh temp `CY_AGENT_HOME` — full runs never touch real `~/.cy-agent` data.

## Conventions (tooling does not enforce these)

- Comments and test names are Korean; comments explain *why*, not *what*.
- Tests live next to the source (`agent/src/x.test.ts`, `desktop/test/x.test.js`) and use `node:test` with fake fetch/temp dirs — no new dependency for a few lines, no mocks coupled to the implementation.
- `desktop/src/*.js` is pure logic with injectable clocks/IO; DOM lives only in `desktop/renderer/`.
- Never write tokens or secrets into logs, errors, or replies.
