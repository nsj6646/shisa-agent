// pi 코드 작업 실행기: 공식 pi RPC(JSONL)를 자식 프로세스로 띄우고, 시사의 코드 작업 세션에 맞물린다.
// 실행 방식(2026-08 기준 pi 1.3): `pi --mode rpc` ↔ stdin/stdout JSONL(명령·응답·이벤트).
// 안전:
//   - 개인 pi 설정·인증·확장·MCP·스킬을 읽지 않는다: PI_CODING_AGENT_DIR 을 시사가 만든 임시 홈으로, --no-extensions --no-approve
//     --no-mcp --no-skills --no-context-files. 시사가 싣는 것은 승인 창구 확장(pi-gate.js) 하나뿐이다.
//   - 키는 명령줄 인자·환경변수로 넘기지 않는다: 임시 홈의 auth.json(0600)에만 넣고, 그 홈은 작업이 끝나면 지운다.
//     공급자 키 환경변수는 자식에게서 지운다(다른 키로 몰래 전환하지 않게).
//   - 모든 도구 호출은 시사가 판정한다(decideTool). 답이 없으면 막는다 — 셸은 늘 승인 카드, 파일 도구는 규칙대로.
//   - 최종 결과는 모델의 마지막 글이 시사가 시킨 JSON 일 때만. 아니면 실패로 끝낸다(접수·중간 종료를 완료로 세지 않는다).
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, readdirSync, lstatSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSpec, type Plat } from "./plat.ts";
import type { query } from "@anthropic-ai/claude-agent-sdk";

type Message = Record<string, any>;

export const PI_MISSING = "pi 명령을 찾지 못했어요. pi(pi-coding-agent)를 설치한 뒤 데몬을 다시 켜 주세요";
export const PI_NOT_READY = "pi 코드 작업 설정이 비어 있어요(OpenRouter 키·코딩 모델)";
export const PI_BAD_RESULT = "pi가 작업 결과를 정해진 JSON 으로 보고하지 않았어요";
// 시사의 승인 창구 확장(개인 확장 아님). 시사 소스 옆에 있고 -e 로만 싣는다
export const PI_GATE_PATH = join(dirname(fileURLToPath(import.meta.url)), "pi-gate.js");

// 시사가 정한 최종 보고 형식(fixer.ts FIX_SCHEMA 와 같은 모양). 시스템 프롬프트 끝에 붙인다
export const PI_RESULT_RULES = '작업을 마치면 마지막 답을 설명·코드펜스 없이 아래 JSON 한 덩이로만 쓴다:\n{"summary":"무엇을 바꿨는지 2~4줄(한국어)","tests_ran":"실행한 테스트 명령(없으면 빈 문자열)","tests_passed":true}';

// ── 임시 pi 홈(시사가 관리하는 키·지침만 든다) ───────────────────────
export const PI_HOME_PREFIX = "shisa-pi-home-";
const PI_HOME_NAME = /^shisa-pi-home-[A-Za-z0-9]{6}$/;
const activeHomes = new Set<string>();
export const activePiHomes = () => [...activeHomes];

// 데몬 시작 때: 지난 실행이 남긴 임시 홈(내 것만) 지우기. 지금 쓰는 것은 둔다
export function cleanupStalePiHomes(dir = tmpdir(), keep: string[] = activePiHomes()): string[] {
  const removed: string[] = [];
  let names: string[] = [];
  try { names = readdirSync(dir); } catch { return removed; }
  const uid = typeof process.getuid === "function" ? process.getuid() : undefined;
  for (const name of names) {
    if (!PI_HOME_NAME.test(name)) continue;
    const p = join(dir, name);
    if (keep.includes(p)) continue;
    try {
      const st = lstatSync(p);
      if (!st.isDirectory() || st.isSymbolicLink() || (uid !== undefined && st.uid !== uid)) continue;
      rmSync(p, { recursive: true, force: true });
      removed.push(p);
    } catch { /* 다음 */ }
  }
  return removed;
}

// 자식 환경: 개인 공급자 키는 지우고, 설정 폴더만 시사 임시 홈으로. 키는 여기 없다(auth.json 으로만)
const STRIP_ENV = [
  "OPENROUTER_API_KEY", "CY_AGENT_OPENROUTER_API_KEY", "ANTHROPIC_API_KEY", "ANTHROPIC_OAUTH_TOKEN", "ANTHROPIC_AUTH_TOKEN",
  "OPENAI_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY", "GENSPARK_API_KEY", "GITHUB_COPILOT_TOKEN", "AI_GATEWAY_API_KEY",
  "DEEPSEEK_API_KEY", "GROQ_API_KEY", "XAI_API_KEY", "MISTRAL_API_KEY", "ZAI_API_KEY", "MOONSHOT_API_KEY",
];
export function piEnv(base: NodeJS.ProcessEnv, home: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...base };
  for (const k of STRIP_ENV) delete env[k];
  env.PI_CODING_AGENT_DIR = home; // 개인 ~/.pi/agent 를 안 읽는다
  env.PI_SKIP_VERSION_CHECK = "1";
  env.PI_TELEMETRY = "0";
  return env;
}

// pi 인자: 개인 자원을 다 끄고, 시사 승인 창구 하나만 싣는다. 모델은 OpenRouter + 지정 이름(다른 공급자로 몰래 가지 않게)
export function piArgs(spec: { model: string; gatePath?: string; promptPath?: string; plat?: Plat }): string[] {
  const tools = (spec.plat ?? process.platform) === "win32"
    ? "read,powershell,edit,write,grep,find,ls"
    : "read,bash,edit,write,grep,find,ls";
  return [
    "--mode", "rpc", "--no-session", "--no-approve",
    "--no-extensions", "--no-mcp", "--no-skills", "--no-prompt-templates", "--no-themes", "--no-context-files",
    "--provider", "openrouter", "--model", spec.model, "--tools", tools,
    ...(spec.gatePath ? ["-e", spec.gatePath] : []),
    ...(spec.promptPath ? ["--append-system-prompt", spec.promptPath] : []),
  ];
}

// ── 도구 판정 위임(고정 타입) ────────────────────────────────────────
export type PiToolCall = { name: string; input: Record<string, unknown> };
export type PiDecision = { allow: boolean; reason?: string };
export type PiDecider = (call: PiToolCall, signal?: AbortSignal) => Promise<PiDecision>;

// ── 최종 결과(모델의 마지막 글) ──────────────────────────────────────
export function parsePiOutput(text: string): { summary: string; tests_ran: string; tests_passed: boolean } | undefined {
  const t = String(text ?? "").trim();
  const candidates = [t, ...[...t.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)].map((m) => m[1])];
  const at = t.lastIndexOf("{");
  if (at >= 0) candidates.push(t.slice(at));
  for (const c of candidates) {
    try {
      const o = JSON.parse(c.trim());
      if (o && typeof o === "object" && !Array.isArray(o) && typeof o.summary === "string" && typeof o.tests_ran === "string" && typeof o.tests_passed === "boolean") {
        return { summary: o.summary, tests_ran: o.tests_ran, tests_passed: o.tests_passed };
      }
    } catch { /* 다음 후보 */ }
  }
  return undefined;
}

// 이벤트 큐(codex-coder 와 같은 모양)
class Queue {
  values: Message[] = [];
  wake?: () => void;
  ended = false;
  error?: Error;
  push(v: Message) { this.values.push(v); this.wake?.(); }
  close(error?: Error) { this.error = error; this.ended = true; this.wake?.(); }
  async *[Symbol.asyncIterator]() {
    while (true) {
      if (this.values.length) { yield this.values.shift()!; continue; }
      if (this.ended) { if (this.error) throw this.error; return; }
      await new Promise<void>((r) => { this.wake = r; });
    }
  }
}

const userTextOf = (user: any): string => {
  const content = user?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.filter((b: any) => b?.type === "text").map((b: any) => b.text).join("\n");
  return String(content ?? "");
};

// pi AssistantMessage.ToolCall → Claude SDK tool_use 블록
const claudeBlocks = (content: unknown): Message[] => {
  const out: Message[] = [];
  for (const b of Array.isArray(content) ? content : []) {
    if (b?.type === "text") out.push({ type: "text", text: String(b.text ?? "") });
    else if (b?.type === "toolCall") out.push({ type: "tool_use", id: String(b.id ?? ""), name: String(b.name ?? ""), input: b.arguments && typeof b.arguments === "object" ? b.arguments : {} });
  }
  return out;
};

export function createPiQuery(
  { prompt, options = {} }: { prompt: string | AsyncIterable<any>; options?: Message },
  deps: { spawn?: typeof spawn; apiKey?: string; env?: NodeJS.ProcessEnv; homeDir?: string; plat?: Plat } = {},
) {
  const events = new Queue();
  const cwd = resolve(String(options.cwd ?? process.cwd()));
  const model = String(options.model ?? "");
  const apiKey = deps.apiKey ?? "";
  const signal: AbortSignal | undefined = options.abortController?.signal;
  const decide: PiDecider | undefined = options.decideTool;
  const plat = deps.plat ?? process.platform;
  const baseEnv = deps.env ?? process.env;
  if (!model || !apiKey) throw new Error(PI_NOT_READY);

  let home = deps.homeDir ?? "";
  let ownHome = false;
  let child: ReturnType<typeof spawn> | undefined;
  let stopped = false;
  let seq = 0;
  let text = "";
  let lastUuid: string | undefined; // 지금 턴을 연 세션 창 메시지(전달 확인용)
  let stopError: string | undefined;
  let settle: (() => void) | undefined;
  let fail: ((e: Error) => void) | undefined;
  let spoke = false; // pi 가 프로토콜 기록을 하나라도 말했나(설치·버전 문제와 도중 종료를 가른다)
  const cmds = new Map<string, { resolve: () => void; reject: (e: Error) => void }>(); // 응답을 기다리는 명령(set_model 등)

  const releaseHome = () => {
    if (!ownHome || !home) return;
    activeHomes.delete(home);
    try { rmSync(home, { recursive: true, force: true }); } catch { /* 다음 시작 때 지운다 */ }
    ownHome = false;
  };
  const cleanup = (error?: Error) => {
    if (stopped) return;
    stopped = true;
    fail?.(error ?? new Error("pi 실행이 끝났어요"));
    settle = undefined; fail = undefined;
    for (const c of cmds.values()) c.reject(new Error("pi 실행이 끝났어요"));
    cmds.clear();
    releaseHome();
    events.close(error);
    try { child?.stdin?.end(); } catch { /* 이미 닫힘 */ }
    try { child?.kill("SIGTERM"); } catch { /* 이미 죽음 */ }
    const t = setTimeout(() => { try { if (child && child.exitCode === null) child.kill("SIGKILL"); } catch { /* 이미 죽음 */ } }, 3000);
    t.unref?.();
  };
  const abort = () => cleanup();
  signal?.addEventListener("abort", abort, { once: true });

  // 임시 홈: 키는 auth.json(0600)으로만, 시사 지침은 파일로만(명령줄·환경변수에 비밀을 싣지 않는다)
  let promptPath: string | undefined;
  try {
    home = deps.homeDir ?? mkdtempSync(join(tmpdir(), PI_HOME_PREFIX));
    ownHome = !deps.homeDir;
    if (ownHome) activeHomes.add(home);
    writeFileSync(join(home, "auth.json"), JSON.stringify({ openrouter: { type: "api_key", key: apiKey } }), { mode: 0o600 });
    const systemText = typeof options.systemPrompt === "string" ? options.systemPrompt : String(options.systemPrompt?.append ?? "");
    if (systemText) {
      promptPath = join(home, "system-append.md");
      writeFileSync(promptPath, `${systemText}\n\n${PI_RESULT_RULES}\n`, { mode: 0o600 });
    }
  } catch (e) { releaseHome(); throw e; }

  const write = (data: Message) => { if (!stopped && child?.stdin && !child.stdin.destroyed) child.stdin.write(JSON.stringify(data) + "\n"); };
  const spec = spawnSpec("pi", piArgs({ model, gatePath: PI_GATE_PATH, ...(promptPath ? { promptPath } : {}), plat }), baseEnv, plat, existsSync);
  try {
    child = (deps.spawn ?? spawn)(spec.file, spec.args, { cwd, env: piEnv(baseEnv, home), stdio: ["pipe", "pipe", "pipe"], windowsVerbatimArguments: spec.verbatim });
  } catch (e) { releaseHome(); throw e; }
  child.on("error", () => cleanup(new Error(PI_MISSING)));
  child.on("exit", (code) => {
    if (stopped) return;
    cleanup(new Error(spoke ? `pi 실행이 도중에 끝났어요 (${code ?? "신호"})` : `pi 실행이 시작하지 못했어요 (${code ?? "신호"}) — pi 설치·버전을 확인해 주세요`));
  });
  child.stderr?.resume(); // 진단 로그는 UI·기록에 넣지 않는다(키가 섞일 수 있다)

  const respondTool = async (id: unknown, payload: any) => {
    let call: PiToolCall | undefined;
    try {
      const o = JSON.parse(String(payload ?? ""));
      if (o && typeof o.tool === "string") call = { name: o.tool, input: o.input && typeof o.input === "object" ? o.input : {} };
    } catch { /* 모르는 요청 */ }
    let d: PiDecision = { allow: false, reason: "시사: 승인 창구가 답하지 않았어요" };
    if (call && decide) {
      try { d = await decide(call, signal); } catch { d = { allow: false, reason: "시사: 승인 판정에 실패했어요" }; }
    }
    write({ type: "extension_ui_response", id, value: JSON.stringify(d) });
  };

  // stdout: LF 로만 자른다(JSON 안의 U+2028/U+2029 를 줄바꿈으로 보면 안 된다)
  let buf = "";
  child.stdout?.on("data", (chunk: Buffer) => {
    buf += chunk.toString("utf8");
    let at: number;
    while ((at = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, at).replace(/\r$/, "");
      buf = buf.slice(at + 1);
      if (!line.trim()) continue;
      let msg: Message;
      try { msg = JSON.parse(line); } catch { continue; }
      if (!msg || typeof msg !== "object") continue;
      spoke = true;
      if (msg.type === "extension_ui_request") {
        if (msg.method === "input" && msg.title === "shisa-tool") void respondTool(msg.id, msg.placeholder);
        else if (["input", "select", "confirm", "editor"].includes(String(msg.method))) write({ type: "extension_ui_response", id: msg.id, cancelled: true });
        continue;
      }
      if (msg.type === "response" && typeof msg.id === "string" && cmds.has(msg.id)) {
        const c = cmds.get(msg.id)!;
        cmds.delete(msg.id);
        if (msg.success === false) c.reject(new Error(`pi 요청 실패(${String(msg.command ?? "")}): ${String(msg.error ?? "").slice(0, 300)}`));
        else c.resolve();
        continue;
      }
      if (msg.type === "response" && msg.success === false) {
        // 프롬프트가 거절됐다(모델·공급자 오류 등): 지금 도는 턴을 실패로 끝낸다
        if (msg.command === "prompt") {
          fail?.(new Error(`pi 요청 실패(prompt): ${String(msg.error ?? "").slice(0, 300)}`));
          settle = undefined; fail = undefined;
        }
        continue;
      }
      if (msg.type === "message_end") {
        const m = msg.message ?? {};
        if (m.role === "assistant") {
          const content = claudeBlocks(m.content);
          text = content.filter((b) => b.type === "text").map((b) => b.text).join("");
          if (m.stopReason === "error") stopError = String(m.errorMessage ?? "모델 응답 오류");
          else stopError = undefined;
          const u = m.usage ?? {};
          const usage = { input_tokens: u.input ?? 0, output_tokens: u.output ?? 0, cache_creation_input_tokens: u.cacheWrite ?? 0, cache_read_input_tokens: u.cacheRead ?? 0 };
          events.push({ type: "assistant", parent_tool_use_id: null, message: { id: m.responseId ?? undefined, role: "assistant", content, usage, model: m.responseModel ?? m.model ?? model } });
        } else if (m.role === "toolResult") {
          events.push({ type: "user", parent_tool_use_id: null, message: { role: "user", content: [{ type: "tool_result", tool_use_id: m.toolCallId, content: (Array.isArray(m.content) ? m.content : []).filter((b: any) => b?.type === "text").map((b: any) => b.text).join("\n"), is_error: m.isError === true }] } });
        }
        continue;
      }
      if (msg.type === "agent_settled") {
        const aborted = msg.aborted === true;
        const want = !!options.outputFormat?.schema;
        const out = !aborted && !stopError && want ? parsePiOutput(text) : undefined;
        const uuids = lastUuid ? [lastUuid] : [];
        if (aborted) events.push({ type: "result", subtype: "interrupted", result: text, user_message_uuids: uuids });
        else if (stopError) events.push({ type: "result", subtype: "error", result: stopError, is_error: true, user_message_uuids: uuids });
        else if (want && !out) events.push({ type: "result", subtype: "error_result", result: PI_BAD_RESULT, is_error: true, user_message_uuids: uuids });
        else events.push({ type: "result", subtype: "success", result: text, ...(out ? { structured_output: out } : {}), user_message_uuids: uuids });
        const done = settle; settle = undefined; fail = undefined;
        done?.();
        continue;
      }
      if (msg.type === "extension_error") {
        events.push({ type: "system", subtype: "gate", text: `승인 창구 오류: ${String(msg.error ?? "").slice(0, 200)}` });
        continue;
      }
    }
  });

  // 첫 프롬프트가 문자열일 수 있다(다른 실행기와 같은 계약)
  const input = typeof prompt === "string"
    ? (async function* () { yield { message: { content: prompt } }; })()
    : prompt;
  void (async () => {
    try {
      if (signal?.aborted) { cleanup(); return; }
      for await (const user of input) {
        if (stopped) break;
        const id = `p${++seq}`;
        lastUuid = typeof user?.uuid === "string" ? user.uuid : undefined;
        const done = new Promise<void>((res, rej) => { settle = res; fail = rej; });
        done.catch(() => {});
        write({ id, type: "prompt", message: userTextOf(user) }); // pi 는 한 턴이 끝난 뒤에만 다음 프롬프트를 받는다(이어 하기는 후속 티켓)
        await done;
      }
      cleanup();
    } catch (e) {
      if (!stopped) cleanup(e as Error);
    } finally {
      signal?.removeEventListener("abort", abort);
    }
  })();

  return {
    [Symbol.asyncIterator]: () => events[Symbol.asyncIterator](),
    interrupt: async () => { write({ type: "abort" }); },
    // pi 의 set_model 은 { provider, modelId } 를 받는다(rpc-commands.md). 실패는 이 호출에만 돌려준다(도는 턴은 안 죽인다)
    setModel: async (next: string) => {
      const at = next.indexOf("/");
      const provider = at > 0 ? next.slice(0, at) : "openrouter"; // pi 실행기는 OpenRouter 로만 돈다
      const modelId = at > 0 ? next.slice(at + 1) : next;
      await new Promise<void>((resolve, reject) => {
        const id = `m${++seq}`;
        cmds.set(id, { resolve, reject });
        write({ id, type: "set_model", provider, modelId });
      });
    },
  };
}
export const piQuery = createPiQuery as unknown as typeof query;
