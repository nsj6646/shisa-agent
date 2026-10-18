// pi 코드 작업 실행기(pi-coder.ts): RPC 프로토콜 매핑·승인 중계·임시 홈(키)·최종 JSON·중지.
// 실제 pi 는 띄우지 않는다 — 같은 JSONL 을 말하는 가짜 스크립트를 node 로 돌린다(stdio 프레이밍은 진짜로 지나간다).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { createPiQuery, parsePiOutput, piArgs, piEnv, cleanupStalePiHomes, PI_HOME_PREFIX, PI_NOT_READY } from "./pi-coder.ts";

const FAKE_PI = `
import { readFileSync, writeFileSync } from "node:fs";
const out = (o) => process.stdout.write(JSON.stringify(o) + "\\n");
let buf = "", pendingAsk = null;
process.stdin.on("data", async (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf("\\n")) >= 0) {
    const line = buf.slice(0, i); buf = buf.slice(i + 1);
    if (!line.trim()) continue;
    let m; try { m = JSON.parse(line); } catch { continue; }
    if (m.type === "extension_ui_response") { if (process.env.FAKE_DECISION_OUT) writeFileSync(process.env.FAKE_DECISION_OUT, String(m.value ?? "")); pendingAsk?.(); continue; }
    if (m.type === "abort") { out({ id: m.id, type: "response", command: "abort", success: true }); out({ type: "agent_settled", aborted: true }); continue; }
    if (m.type === "set_model") {
      writeFileSync(process.env.FAKE_MODEL_OUT, JSON.stringify({ provider: m.provider ?? null, modelId: m.modelId ?? null }));
      out(process.env.FAKE_MODEL_FAIL ? { id: m.id, type: "response", command: "set_model", success: false, error: "Model not found: x/y" } : { id: m.id, type: "response", command: "set_model", success: true });
      continue;
    }
    if (m.type !== "prompt") continue;
    if (process.env.FAKE_OUT) {
      let auth = null;
      try { auth = readFileSync(process.env.PI_CODING_AGENT_DIR + "/auth.json", "utf8"); } catch {}
      writeFileSync(process.env.FAKE_OUT, JSON.stringify({ argv: process.argv.slice(2), text: String(m.message ?? ""), key: process.env.OPENROUTER_API_KEY ?? null, dir: process.env.PI_CODING_AGENT_DIR, auth }));
    }
    out({ id: m.id, type: "response", command: "prompt", success: true, data: { disposition: "started" } });
    out({ type: "agent_start" });
    if (process.env.FAKE_HANG) { out({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "작업 중" }], stopReason: "pending", usage: {}, model: "fake/model" } }); return; }
    if (process.env.FAKE_TOOL) {
      const input = JSON.parse(process.env.FAKE_TOOL_INPUT ?? "{}");
      out({ type: "message_end", message: { role: "assistant", content: [{ type: "toolCall", id: "t1", name: process.env.FAKE_TOOL, arguments: input }], stopReason: "toolUse", usage: {}, model: "fake/model" } });
      out({ type: "extension_ui_request", id: "ask-1", method: "input", title: "shisa-tool", placeholder: JSON.stringify({ tool: process.env.FAKE_TOOL, input }) });
      await new Promise((r) => { pendingAsk = r; });
      out({ type: "message_end", message: { role: "toolResult", toolCallId: "t1", toolName: process.env.FAKE_TOOL, content: [{ type: "text", text: "tool done" }], isError: false } });
    }
    const reply = process.env.FAKE_BAD === "1" ? "결과를 JSON 으로 쓰지 않았다" : JSON.stringify({ summary: "요약", tests_ran: "npm test", tests_passed: true });
    out({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: reply }], stopReason: "stop", usage: {}, model: "fake/model" } });
    out({ type: "agent_settled", aborted: false });
  }
});
process.stdin.resume();
`;

type Fake = { dir: string; done: () => void; spawn: typeof spawn };
function fakePi(): Fake {
  const dir = mkdtempSync(join(tmpdir(), "cy-fake-pi-"));
  const script = join(dir, "fake-pi.mjs");
  writeFileSync(script, FAKE_PI);
  return {
    dir,
    // createPiQuery 는 "pi" 를 띄우려 한다 — 같은 인자로 가짜 스크립트를 node 로 돌린다
    spawn: ((_file: string, args: string[], opts: any) => spawn(process.execPath, [script, ...(args as string[])], opts)) as unknown as typeof spawn,
    done: () => rmSync(dir, { recursive: true, force: true }),
  };
}

// 끝까지 흘려보낸다: result 뒤 입력이 닫히면 실행기가 자식을 정리하고 제너레이터가 끝난다
async function drain(q: AsyncIterable<any>): Promise<any[]> {
  const out: any[] = [];
  for await (const m of q) out.push(m);
  return out;
}

test("pi RPC 매핑: 도구 호출·결과·최종 JSON → 구조화 출력, 중간 이벤트는 완료로 세지 않는다", async () => {
  const f = fakePi();
  const home = mkdtempSync(join(tmpdir(), "cy-pi-home-"));
  const outFile = join(f.dir, "out.json");
  try {
    const calls: any[] = [];
    const q = createPiQuery({ prompt: "고쳐 줘", options: {
      cwd: f.dir, model: "openai/gpt-4.1-mini", apiKey: "sk-or-secret-key",
      outputFormat: { type: "json_schema", schema: { type: "object" } },
      systemPrompt: { type: "preset", preset: "claude_code", append: "시사 지침" },
      decideTool: async (call: { name: string; input: Record<string, unknown> }) => { calls.push(call); return { allow: true }; },
    } }, { apiKey: "sk-or-secret-key", spawn: f.spawn, env: { ...process.env, FAKE_TOOL: "bash", FAKE_TOOL_INPUT: JSON.stringify({ command: "npm test" }), FAKE_OUT: outFile, FAKE_DECISION_OUT: join(f.dir, "decision.txt") }, homeDir: home, plat: "linux" });

    const events = await drain(q);
    const assistant = events.filter((m) => m.type === "assistant");
    assert.deepEqual(assistant[0].message.content[0], { type: "tool_use", id: "t1", name: "bash", input: { command: "npm test" } });
    const toolResult = events.find((m) => m.type === "user" && m.message.content[0].type === "tool_result");
    assert.equal(toolResult.message.content[0].tool_use_id, "t1");
    const result = events.at(-1)!;
    assert.equal(result.subtype, "success");
    assert.deepEqual(result.structured_output, { summary: "요약", tests_ran: "npm test", tests_passed: true });
    assert.deepEqual(calls, [{ name: "bash", input: { command: "npm test" } }], "도구 판정은 시사가 받는다");
    assert.equal(readFileSync(join(f.dir, "decision.txt"), "utf8"), JSON.stringify({ allow: true }), "허용 답이 pi 로 돌아간다");
    // 키는 argv·환경변수로 가지 않는다 — 임시 홈 auth.json 으로만
    const seen = JSON.parse(readFileSync(outFile, "utf8"));
    assert.equal(seen.key, null, "자식 환경에 공급자 키가 없다");
    assert.equal(seen.argv.join(" ").includes("sk-or-secret-key"), false, "키는 명령줄 인자에 없다");
    assert.ok(seen.argv.join(" ").includes("--provider openrouter"), "공급자는 명시적으로 OpenRouter");
    assert.ok(seen.argv.join(" ").includes("--model openai/gpt-4.1-mini"));
    assert.deepEqual(JSON.parse(seen.auth), { openrouter: { type: "api_key", key: "sk-or-secret-key" } });
    assert.ok(seen.dir.startsWith(home), "설정 폴더는 시사 임시 홈");
    assert.equal(existsSync(join(home, "system-append.md")), true, "시사 지침·최종 JSON 규칙을 파일로 싣는다");
  } finally { f.done(); rmSync(home, { recursive: true, force: true }); }
});

test("pi 승인: 거부된 도구는 pi 에 거부 답이 가고, 답이 없으면(판정 없음) 막힌다", async () => {
  const f = fakePi();
  const home = mkdtempSync(join(tmpdir(), "cy-pi-home-"));
  try {
    const q = createPiQuery({ prompt: "x", options: {
      cwd: f.dir, model: "openai/gpt-4.1-mini", apiKey: "k", outputFormat: { type: "json_schema", schema: {} },
      decideTool: async () => ({ allow: false, reason: "위험한 명령" }),
    } }, { apiKey: "sk-or-secret-key", spawn: f.spawn, env: { ...process.env, FAKE_TOOL: "bash", FAKE_TOOL_INPUT: "{}", FAKE_DECISION_OUT: join(f.dir, "decision.txt") }, homeDir: home, plat: "linux" });
    await drain(q);
    assert.deepEqual(JSON.parse(readFileSync(join(f.dir, "decision.txt"), "utf8")), { allow: false, reason: "위험한 명령" });

    // decideTool 이 없으면 어떤 도구도 허용되지 않는다
    const f2 = fakePi();
    const q2 = createPiQuery({ prompt: "x", options: { cwd: f2.dir, model: "m", apiKey: "k", outputFormat: { type: "json_schema", schema: {} } } },
      { apiKey: "k", spawn: f2.spawn, env: { ...process.env, FAKE_TOOL: "bash", FAKE_TOOL_INPUT: "{}", FAKE_DECISION_OUT: join(f2.dir, "d.txt") }, homeDir: home, plat: "linux" });
    await drain(q2);
    assert.equal(JSON.parse(readFileSync(join(f2.dir, "d.txt"), "utf8")).allow, false);
    f2.done();
  } finally { f.done(); rmSync(home, { recursive: true, force: true }); }
});

test("pi 최종 결과: JSON 이 아니면 성공으로 세지 않는다(error_result)", async () => {
  const f = fakePi();
  const home = mkdtempSync(join(tmpdir(), "cy-pi-home-"));
  try {
    const q = createPiQuery({ prompt: "x", options: { cwd: f.dir, model: "m", apiKey: "k", outputFormat: { type: "json_schema", schema: {} } } },
      { apiKey: "k", spawn: f.spawn, env: { ...process.env, FAKE_BAD: "1" }, homeDir: home, plat: "linux" });
    const events = await drain(q);
    assert.equal(events.at(-1)!.subtype, "error_result");
    assert.equal(events.at(-1)!.structured_output, undefined);
  } finally { f.done(); rmSync(home, { recursive: true, force: true }); }
});

test("pi 중지: abortController 를 끊으면 자식을 정리하고 조용히 끝난다(작업 완료로 세지 않는다)", async () => {
  const f = fakePi();
  const home = mkdtempSync(join(tmpdir(), "cy-pi-home-"));
  const abort = new AbortController();
  try {
    const q = createPiQuery({ prompt: "x", options: { cwd: f.dir, model: "m", apiKey: "k", outputFormat: { type: "json_schema", schema: {} }, abortController: abort } },
      { apiKey: "k", spawn: f.spawn, env: { ...process.env, FAKE_HANG: "1" }, homeDir: home, plat: "linux" });
    const it = q[Symbol.asyncIterator]();
    const first = await it.next();
    assert.equal((first.value as any)?.type, "assistant");
    abort.abort();
    const end = await it.next();
    assert.equal(end.done, true, "남은 이벤트 없이 끝난다(결과 이벤트를 만들지 않는다)");
  } finally { f.done(); rmSync(home, { recursive: true, force: true }); }
});

test("pi set_model: {provider, modelId} 로 보낸다(실패는 그 호출에만)", async () => {
  const f = fakePi();
  const home = mkdtempSync(join(tmpdir(), "cy-pi-home-"));
  const abort = new AbortController();
  const modelOut = join(f.dir, "model.json");
  try {
    const q = createPiQuery({ prompt: "x", options: { cwd: f.dir, model: "openai/gpt-4.1-mini", outputFormat: { type: "json_schema", schema: {} }, abortController: abort } },
      { apiKey: "k", spawn: f.spawn, env: { ...process.env, FAKE_MODEL_OUT: modelOut }, homeDir: home, plat: "linux" });
    await q.setModel("openai/gpt-4.1-mini");
    assert.deepEqual(JSON.parse(readFileSync(modelOut, "utf8")), { provider: "openai", modelId: "gpt-4.1-mini" });

    const q2 = createPiQuery({ prompt: "x", options: { cwd: f.dir, model: "m", outputFormat: { type: "json_schema", schema: {} }, abortController: abort } },
      { apiKey: "k", spawn: f.spawn, env: { ...process.env, FAKE_MODEL_OUT: modelOut, FAKE_MODEL_FAIL: "1" }, homeDir: home, plat: "linux" });
    await assert.rejects(q2.setModel("openai/nope"), /pi 요청 실패\(set_model\)/);
  } finally { abort.abort(); f.done(); rmSync(home, { recursive: true, force: true }); }
});

test("parsePiOutput: JSON·코드펜스·섞인 글에서 찾고, 모양이 틀리면 undefined", () => {
  const ok = { summary: "요약", tests_ran: "t", tests_passed: true };
  assert.deepEqual(parsePiOutput(JSON.stringify(ok)), ok);
  assert.deepEqual(parsePiOutput(`끝났어요\n\`\`\`json\n${JSON.stringify(ok)}\n\`\`\``), ok);
  assert.deepEqual(parsePiOutput(`설명\n{"summary":"요약","tests_ran":"t","tests_passed":true}`), ok);
  assert.equal(parsePiOutput("그냥 글"), undefined);
  assert.equal(parsePiOutput('{"summary":"x"}'), undefined);
  assert.equal(parsePiOutput(""), undefined);
});

test("임시 홈·인자·환경: 개인 설정을 안 읽고, 지난 임시 홈만 지운다", () => {
  const args = piArgs({ model: "openai/gpt-4.1-mini", gatePath: "/tmp/gate.mjs", promptPath: "/tmp/p.md", plat: "linux" });
  assert.ok(args.includes("--no-extensions") && args.includes("--no-mcp") && args.includes("--no-approve") && args.includes("--no-context-files"));
  assert.equal(args[args.indexOf("--tools") + 1], "read,bash,edit,write,grep,find,ls");
  const win = piArgs({ model: "m", plat: "win32" });
  assert.equal(win[win.indexOf("--tools") + 1], "read,powershell,edit,write,grep,find,ls");
  const env = piEnv({ PATH: "/x", OPENROUTER_API_KEY: "secret", ANTHROPIC_API_KEY: "a" }, "/tmp/home");
  assert.equal(env.OPENROUTER_API_KEY, undefined);
  assert.equal(env.ANTHROPIC_API_KEY, undefined);
  assert.equal(env.PI_CODING_AGENT_DIR, "/tmp/home");
  assert.equal(env.PI_TELEMETRY, "0");

  const dir = mkdtempSync(join(tmpdir(), "cy-pi-stale-"));
  try {
    const keep = mkdtempSync(join(dir, PI_HOME_PREFIX));
    const stale = mkdtempSync(join(dir, PI_HOME_PREFIX));
    const other = join(dir, "shisa-codex-home-abc123");
    mkdirSync(other);
    assert.deepEqual(cleanupStalePiHomes(dir, [keep]), [stale]);
    assert.deepEqual([existsSync(keep), existsSync(stale), existsSync(other)], [true, false, true]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
  assert.throws(() => createPiQuery({ prompt: "x", options: { cwd: ".", model: "m" } }), (e: any) => e?.message === PI_NOT_READY);
});
