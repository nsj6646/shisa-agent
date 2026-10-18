// OpenRouter 뇌: 공개 모델 목록과 자격 증명 확인을 구분하고, 모델 ID의 `/` 를 정확히 유지하며,
// 401·402·403·429·200 안의 오류를 구분한다. 실제 키·유료 호출은 쓰지 않는다(가짜 fetch).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "./config.ts";
import { Settings } from "./settings.ts";
import { chatModels, resetChatModels } from "./chat-models.ts";
import { askedModel } from "./brain.ts";
import { statusOf } from "./status.ts";
import { Connections } from "./connections.ts";
import { Bus, bodyPick } from "./bus.ts";
import { ask, SCHEMA as BRAIN_SCHEMA } from "./brain.ts";
import type { ContentBlock } from "./attachments.ts";
import { brainKeyReady, openrouterKey } from "./providers.ts";
import { modelFits, roleModel } from "./models.ts";
import {
  BrainAuthError, BrainCreditError, OPENROUTER_DEFAULT_MODEL, OPENROUTER_URL, brainAuthFailed, brainCreditNeeded, keyTrouble,
  openrouterJson, openrouterModels, resetBrainAuth, type FetchLike,
} from "./providers.ts";

const FAKE = "sk-or-v1-unit-test-fake-key-000000000000000000000000";
const SCHEMA = { type: "object", additionalProperties: false, required: ["reply"], properties: { reply: { type: "string" }, note: { type: "string" } } };
const chatBody = (content: string) => JSON.stringify({ id: "x", object: "chat.completion", choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }] });

function cfgOf(extra: Record<string, unknown> = {}) {
  return loadConfig({}, { brain: { provider: "openrouter" }, ...extra } as any);
}

test("openrouter 키: CY_AGENT_OPENROUTER_API_KEY > OPENROUTER_API_KEY > 설정, 다른 뇌 값은 보존", () => {
  const cfg = cfgOf({ brain: { provider: "openrouter", geminiApiKey: "AIza-keep" } });
  assert.equal(cfg.brain.provider, "openrouter");
  assert.equal(cfg.brain.geminiApiKey, "AIza-keep");
  assert.equal(openrouterKey(cfg, {}), undefined);
  assert.equal(brainKeyReady(cfg, {}), false);
  const file = cfgOf({ brain: { provider: "openrouter", openrouterApiKey: FAKE, geminiApiKey: "AIza-keep" } });
  assert.equal(openrouterKey(file, {}), FAKE);
  assert.equal(openrouterKey(file, { OPENROUTER_API_KEY: "sk-or-env" }), "sk-or-env");
  assert.equal(openrouterKey(file, { CY_AGENT_OPENROUTER_API_KEY: "sk-or-cy", OPENROUTER_API_KEY: "sk-or-env" }), "sk-or-cy");
  assert.equal(brainKeyReady(file, {}), true);
  assert.equal(file.brain.geminiApiKey, "AIza-keep");
});

test("openrouter 모델 ID: 공급자 접두사와 `/` 가 그대로 남고, 다른 뇌 설정을 덮지 않는다", () => {
  assert.equal(modelFits("openrouter", "openai/gpt-4.1-mini"), true);
  assert.equal(modelFits("openrouter", "anthropic/claude-sonnet-4.5"), true);
  assert.equal(modelFits("openrouter", "openrouter/auto"), true);
  assert.equal(modelFits("openrouter", "gpt-4.1-mini"), false, "접두사 없는 이름은 OpenRouter 모델이 아니다");
  const cfg = loadConfig({}, {
    brain: { provider: "openrouter" },
    brainModels: { openrouter: { general: "anthropic/claude-sonnet-4.5", quick: "openai/gpt-4.1-mini" }, gemini: { general: "gemini-3.5-pro" } },
  } as any);
  assert.equal(roleModel(cfg, "general"), "anthropic/claude-sonnet-4.5");
  assert.equal(roleModel(cfg, "quick"), "openai/gpt-4.1-mini");
  assert.equal(roleModel(cfg, "general", "gemini"), "gemini-3.5-pro", "다른 뇌 값은 남는다");
});

test("openrouter 요청: OpenAI 모양(Bearer·strict json_schema·리다이렉트 차단)에 require_parameters 를 더한다", async () => {
  resetBrainAuth();
  const calls: { url: string; init: any }[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, init });
    return new Response(chatBody(JSON.stringify({ reply: "안녕", note: null })), { status: 200 });
  };
  const cfg = loadConfig({}, {
    brain: { provider: "openrouter", openrouterApiKey: FAKE },
    brainModels: { openrouter: { general: "anthropic/claude-sonnet-4.5" } },
  } as any);
  const out = await openrouterJson(cfg, "hi", SCHEMA, { system: "sys", fetch, env: {} });
  assert.deepEqual(out, { reply: "안녕" }); // strict 의 null 자리는 지운다
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.url, `${OPENROUTER_URL}/chat/completions`);
  assert.equal(calls[0]!.init.redirect, "error");
  assert.equal(calls[0]!.init.headers.Authorization, `Bearer ${FAKE}`);
  const body = JSON.parse(calls[0]!.init.body);
  assert.equal(body.model, "anthropic/claude-sonnet-4.5", "이름표 그대로");
  assert.equal(body.messages[0].role, "system");
  assert.equal(body.response_format.type, "json_schema");
  assert.equal(body.response_format.json_schema.strict, true);
  assert.deepEqual(body.provider, { require_parameters: true }, "구조화 출력을 지원하는 엔드포인트로만 보낸다");
  // 모델을 안 고르면 기본 하나(목록이 바뀌면 모델 탭에서 다시 고른다)
  calls.length = 0;
  const plain = loadConfig({}, { brain: { provider: "openrouter", openrouterApiKey: FAKE } } as any);
  await openrouterJson(plain, "hi", SCHEMA, { fetch, env: {} });
  assert.equal(JSON.parse(calls[0]!.init.body).model, OPENROUTER_DEFAULT_MODEL);
});

const fakeFetch = (make: (init?: any) => Response) => {
  const calls: { url: string; init: any }[] = [];
  const fetch: FetchLike = async (url, init) => { calls.push({ url, init }); return make(init); };
  return { fetch, calls };
};

function keyCfg() {
  return loadConfig({}, { brain: { provider: "openrouter", openrouterApiKey: FAKE } } as any);
}

test("openrouter 오류: 401 만 키 실패, 403 정책은 기억하지 않음, 402 는 크레딧, 200 안의 error 도 처리", async () => {
  const ENV = {};
  // 401 → 키 실패로 기억(키는 글에 안 남는다)
  resetBrainAuth();
  const cfg = keyCfg();
  const a = fakeFetch(() => new Response(JSON.stringify({ error: { code: 401, message: "No auth credentials found" } }), { status: 401 }));
  await assert.rejects(openrouterJson(cfg, "hi", SCHEMA, { fetch: a.fetch, env: ENV }), (e: Error) => e instanceof BrainAuthError && /OpenRouter API 키가 맞지 않아요/.test(e.message) && !e.message.includes(FAKE));
  assert.equal(brainAuthFailed(cfg, ENV), true);
  // 성공한 뒤에는 풀린다
  const ok = fakeFetch(() => new Response(chatBody('{"reply":"ok"}'), { status: 200 }));
  const okCfg = cfg;
  await openrouterJson(okCfg, "hi", SCHEMA, { fetch: ok.fetch, env: ENV });
  assert.equal(brainAuthFailed(okCfg, ENV), false);
  // 403 정책 차단: 키 실패로 기억하지 않는다(다른 요청은 계속 가능)
  resetBrainAuth();
  const p = fakeFetch(() => new Response(JSON.stringify({ error: { message: "Your account is not allowed to use this model" } }), { status: 403 }));
  await assert.rejects(openrouterJson(cfg, "hi", SCHEMA, { fetch: p.fetch, env: ENV }), (e: Error) => !(e instanceof BrainAuthError) && /권한·정책/.test(e.message) && !e.message.includes(FAKE));
  assert.equal(brainAuthFailed(cfg, ENV), false);
  assert.equal(keyTrouble("openrouter", cfg, ENV), undefined);
  // 402 잔액: 크레딧으로 기억(키 실패 아님)
  resetBrainAuth();
  const c = fakeFetch(() => new Response(JSON.stringify({ error: { code: 402, message: "Insufficient credits" } }), { status: 402 }));
  await assert.rejects(openrouterJson(cfg, "hi", SCHEMA, { fetch: c.fetch, env: ENV }), (e: Error) => e instanceof BrainCreditError && /OpenRouter 키는 맞지만 크레딧/.test(e.message));
  assert.equal(brainCreditNeeded(cfg, ENV), true);
  assert.equal(brainAuthFailed(cfg, ENV), false);
  // HTTP 200 안의 error 봉투도 실패로 처리한다(성공으로 넘기지 않는다)
  resetBrainAuth();
  const envelope = fakeFetch(() => new Response(JSON.stringify({ error: { code: 429, message: "Rate limit exceeded" } }), { status: 200 }));
  await assert.rejects(openrouterJson(cfg, "hi", SCHEMA, { fetch: envelope.fetch, env: ENV }), /사용량 한도.*HTTP 200/);
  // 404 = 구조화 출력 지원 엔드포인트 없음 → 모델 탭에서 다시 고르라고 안내
  const none = fakeFetch(() => new Response(JSON.stringify({ error: { code: 404, message: "No endpoints found that support the provided parameters" } }), { status: 404 }));
  await assert.rejects(openrouterJson(cfg, "hi", SCHEMA, { fetch: none.fetch, env: ENV }), /구조화 출력.*모델 탭/);
});

test("openrouter 요청 실패: 429 는 제한된 재시도, 5xx 는 공급자 실패, 네트워크 오류는 짧은 말", async () => {
  resetBrainAuth();
  const cfg = keyCfg();
  let n = 0;
  const waits: number[] = [];
  const busy = fakeFetch(() => (++n < 3 ? new Response(JSON.stringify({ error: { code: 429, message: "Rate limit exceeded" } }), { status: 429 }) : new Response(chatBody('{"reply":"ok"}'), { status: 200 })));
  assert.deepEqual(await openrouterJson(cfg, "hi", SCHEMA, { fetch: busy.fetch, env: {}, sleep: async (ms) => { waits.push(ms); } }), { reply: "ok" });
  assert.deepEqual(waits, [2000, 5000], "재시도는 두 번까지");
  const down = fakeFetch(() => new Response(JSON.stringify({ error: { code: 503, message: "Provider returned error" } }), { status: 503 }));
  await assert.rejects(openrouterJson(cfg, "hi", SCHEMA, { fetch: down.fetch, env: {}, sleep: async () => {} }), /공급자가 지금 답하지 못했어요/);
  const offline: FetchLike = async () => { throw new TypeError(`fetch failed ${FAKE}`); };
  await assert.rejects(openrouterJson(cfg, "hi", SCHEMA, { fetch: offline, env: {} }), (e: Error) => e.message === "OpenRouter 요청을 보내지 못했어요.");
});

test("설정: openrouter 키 등록·교체·해제와 namespaced 세부 모델이 파일·메모리에 그대로, 키는 view 에 없다", () => {
  const dir = mkdtempSync(join(tmpdir(), "openrouter-settings-"));
  try {
    const path = join(dir, "config.json");
    writeFileSync(path, JSON.stringify({ brain: { provider: "gemini", geminiApiKey: "AIza-keep" }, brainModels: { gemini: { general: "gemini-3.5-pro" } } }));
    const cfg = loadConfig({}, JSON.parse(readFileSync(path, "utf8")));
    const s = new Settings(cfg, { path, env: {}, coders: () => ({ claude: null, codex: false }) });
    const r = s.put({ brain: { provider: "openrouter", keys: { openrouter: FAKE }, model: "openai/gpt-4.1-mini" } });
    assert.ok(r.ok);
    assert.equal(cfg.brain.provider, "openrouter");
    assert.equal(cfg.brain.openrouterApiKey, FAKE);
    assert.equal(cfg.brain.geminiApiKey, "AIza-keep", "다른 뇌 키는 그대로");
    assert.equal(roleModel(cfg, "general"), "openai/gpt-4.1-mini");
    // namespaced 세부 모델이 그대로 저장·조회된다
    assert.ok(s.put({ brainModels: { provider: "openrouter", models: { general: "anthropic/claude-sonnet-4.5", quick: null } } }).ok);
    const file = JSON.parse(readFileSync(path, "utf8"));
    assert.equal(file.brainModels.openrouter.general, "anthropic/claude-sonnet-4.5");
    assert.equal(file.brainModels.gemini.general, "gemini-3.5-pro", "다른 뇌 값은 그대로");
    // 데몬을 다시 켜도(파일에서 다시 읽어도) 키·모델이 복원된다
    const reloaded = loadConfig({}, file);
    assert.equal(reloaded.brain.provider, "openrouter");
    assert.equal(reloaded.brain.openrouterApiKey, FAKE);
    assert.equal(roleModel(reloaded, "general"), "anthropic/claude-sonnet-4.5");
    const v = s.view();
    assert.deepEqual(v.brain.keys, { gemini: true, openai: false, anthropic: false, genspark: false, openrouter: true });
    assert.equal(v.brain.model, "anthropic/claude-sonnet-4.5");
    assert.ok(!JSON.stringify(v).includes(FAKE), "view·상태에 키 값은 없다");
    assert.ok(!JSON.stringify(r).includes(FAKE));
    // 접두사 없는 이름은 OpenRouter 모델이 아니다
    assert.equal(s.put({ brainModels: { provider: "openrouter", models: { general: "plain-model" } } }).ok, false);
    // 교체·해제
    assert.ok(s.put({ brain: { keys: { openrouter: "sk-or-v1-second-key-0000000000000000" } } }).ok);
    assert.equal(cfg.brain.openrouterApiKey, "sk-or-v1-second-key-0000000000000000");
    assert.ok(s.put({ brain: { provider: "local", keys: { openrouter: null } } }).ok);
    assert.equal(cfg.brain.openrouterApiKey, undefined);
    assert.equal(JSON.parse(readFileSync(path, "utf8")).brain.openrouterApiKey, undefined);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("chat-models: OpenRouter 는 키가 있어야 준비, 구조화 출력 지원 모델만 보이며 목록 실패가 보인다", async () => {
  resetChatModels(); resetBrainAuth();
  const deps = { env: {}, home: "/nonexistent-home", exists: () => false, commandExists: () => false } as const;
  const cfg = loadConfig({}, { brain: { provider: "openrouter", openrouterApiKey: FAKE } } as any);
  const urls: string[] = [];
  const fetch: FetchLike = async (url) => {
    urls.push(url);
    return new Response(JSON.stringify({ data: [
      { id: "openai/gpt-4.1-mini", name: "GPT-4.1 Mini", supported_parameters: ["structured_outputs"] },
      { id: "some/plain-chat", name: "Plain", supported_parameters: [] },
    ] }), { status: 200 });
  };
  const or = (await chatModels(cfg, { fetch, ...deps })).brains.find((b) => b.provider === "openrouter")!;
  assert.equal(or.ready, true);
  assert.equal(or.tools, false);
  assert.deepEqual(or.models.map((m) => m.id), ["openai/gpt-4.1-mini"], "구조화 출력 미지원 모델은 연결된 것으로 보이지 않는다");
  assert.equal(or.defaultLabel, OPENROUTER_DEFAULT_MODEL);
  assert.match(or.note!, /크레딧/);
  assert.deepEqual(urls, [`${OPENROUTER_URL}/models`]);
  // 키가 없으면 목록을 받지도 않는다
  resetChatModels();
  const nokey = loadConfig({}, { brain: { provider: "openrouter" } } as any);
  const calls: string[] = [];
  const or2 = (await chatModels(nokey, { fetch: async (u) => { calls.push(u); return new Response("{}"); }, ...deps })).brains.find((b) => b.provider === "openrouter")!;
  assert.equal(or2.ready, false);
  assert.match(or2.why!, /키가 없어요/);
  assert.deepEqual(calls, []);
  // 목록 실패는 listError 로 보이고 기본 모델 하나는 남는다
  resetChatModels();
  const or3 = (await chatModels(cfg, { fetch: async () => new Response("busy", { status: 500 }), ...deps })).brains.find((b) => b.provider === "openrouter")!;
  assert.match(or3.listError!, /HTTP 500/);
  assert.deepEqual(or3.models.map((m) => m.id), [OPENROUTER_DEFAULT_MODEL]);
});

test("상태·연결·채팅 고르기: OpenRouter 뇌가 그대로 드러나고 namespaced 모델이 통과한다", () => {
  resetBrainAuth();
  const cfg = keyCfg();
  const st = statusOf(cfg, { env: {} });
  assert.equal(st.brain.label, "OpenRouter");
  assert.equal(st.brain.ready, true);
  const brain = new Connections(cfg, { env: {} }).rows().find((r) => r.id === "brain")!;
  assert.equal(brain.state, "ok");
  assert.match(brain.detail!, /OpenRouter/);
  // 키 없는 OpenRouter 는 이유가 보인다
  const noKey = loadConfig({}, { brain: { provider: "openrouter" } } as any);
  const st2 = statusOf(noKey, { env: {} });
  assert.equal(st2.brain.ready, false);
  assert.match(st2.brain.detail, /OpenRouter API 키가 없어요/);
  // 채팅 고르기 검증: namespaced 모델 이름 통과
  assert.deepEqual(bodyPick({ provider: "openrouter", model: "anthropic/claude-sonnet-4.5" }), { provider: "openrouter", model: "anthropic/claude-sonnet-4.5" });
  assert.equal(askedModel("openrouter", cfg, undefined), OPENROUTER_DEFAULT_MODEL);
});

test("openrouter: 멈춤 신호·깨진 JSON 답은 실패로 끝난다(부수효과 없음)", async () => {
  resetBrainAuth();
  const cfg = keyCfg();
  const ac = new AbortController();
  const hanging: FetchLike = (_url, init) => new Promise((_res, rej) => {
    init?.signal?.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" })));
  });
  const p = openrouterJson(cfg, "hi", SCHEMA, { fetch: hanging, env: {}, signal: ac.signal });
  ac.abort();
  await assert.rejects(p, /멈췄어요/);
  const broken = fakeFetch(() => new Response(chatBody("이건 JSON 이 아니에요"), { status: 200 }));
  await assert.rejects(openrouterJson(cfg, "hi", SCHEMA, { fetch: broken.fetch, env: {} }), /OpenRouter 응답에서 JSON을 읽지 못했어요/);
});

test("openrouter 첨부: 그림·PDF 는 블록으로 실려 나가고, 모델이 못 받으면 그대로 알린다(조용히 버리지 않는다)", async () => {
  resetBrainAuth();
  const calls: { url: string; init: any }[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, init });
    return new Response(JSON.stringify({ error: { code: 404, message: "No endpoints found that support the provided parameters" } }), { status: 404 });
  };
  const blocks: ContentBlock[] = [
    { type: "image", source: { type: "base64", media_type: "image/png", data: "aGk=" } },
    { type: "document", source: { type: "base64", media_type: "application/pdf", data: "aGk=" }, title: "spec.pdf" },
  ];
  await assert.rejects(openrouterJson(keyCfg(), "이 그림과 PDF 봐 줘", SCHEMA, { fetch, env: {}, blocks }), /지원하지 않아요.*모델 탭/);
  const content = JSON.parse(calls[0]!.init.body).messages[0].content as { type: string }[];
  assert.deepEqual(content.slice(1).map((b) => b.type), ["image_url", "file"], "첨부를 조용히 버리지 않는다");
});

test("ask: Claude Code/Codex 없이 OpenRouter 뇌로 구조화 응답을 받는다(캐릭터·JSON 스키마)", async () => {
  resetBrainAuth();
  const calls: { url: string; init: any }[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, init });
    return new Response(chatBody(JSON.stringify({ bubble: "좋아요", reply_md: "오늘 일정 정리했어요", todos: [], done_todo_ids: [], proposals: [] })), { status: 200 });
  };
  const cfg = { ...keyCfg(), brainModels: { openrouter: { general: "openai/gpt-4.1-mini" } } };
  const out = await ask<{ bubble: string }>(cfg, "지금 브리핑해 줘", BRAIN_SCHEMA, undefined, { system: "너는 시사다", deps: { fetch, env: {} } });
  assert.equal(out.bubble, "좋아요");
  assert.equal(calls[0]!.url, `${OPENROUTER_URL}/chat/completions`);
  const body = JSON.parse(calls[0]!.init.body);
  assert.equal(body.model, "openai/gpt-4.1-mini");
  assert.equal(body.messages[0].role, "system");
  assert.match(body.messages[0].content, /시사/);
  assert.equal(body.response_format.json_schema.strict, true);
  assert.deepEqual(body.provider, { require_parameters: true });
});

test("데몬 HTTP: PUT 으로 연결·교체·해제해도 키가 응답·상태에 없고, 채팅은 그 뇌·이름표를 그대로 쓴다", async () => {
  resetBrainAuth();
  const dir = mkdtempSync(join(tmpdir(), "openrouter-http-"));
  const path = join(dir, "config.json");
  writeFileSync(path, JSON.stringify({ slackAppToken: "xapp-keep", brain: { provider: "gemini", geminiApiKey: "AIza-keep-1234567890" } }));
  const cfg = loadConfig({}, JSON.parse(readFileSync(path, "utf8")));
  const s = new Settings(cfg, { path, env: {} });
  const picks: unknown[] = [];
  const bus = new Bus();
  await bus.listen(0, {
    approve: async () => "", hold: async () => "", briefing: async () => "", dashboard: async () => ({}), todoDone: () => true, chatHistory: () => [],
    chat: (_text, opts) => { picks.push(opts?.pick); return { chatId: "c", threadId: "t" }; },
    settings: { get: () => s.view(), put: (b) => s.put(b) },
    status: () => statusOf(cfg, { env: {} }),
  });
  const base = `http://127.0.0.1:${(bus.server!.address() as any).port}`;
  const put = (body: unknown) => fetch(`${base}/settings`, { method: "PUT", headers: { "x-cy-agent": "1", "content-type": "application/json" }, body: JSON.stringify(body) });
  const post = (body: unknown) => fetch(`${base}/chat`, { method: "POST", headers: { "x-cy-agent": "1", "content-type": "application/json" }, body: JSON.stringify(body) });
  try {
    const r = await put({ brain: { provider: "openrouter", keys: { openrouter: FAKE }, model: "openai/gpt-4.1-mini" } });
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.deepEqual(body.settings.brain.keys, { gemini: true, openai: false, anthropic: false, genspark: false, openrouter: true });
    assert.equal(JSON.stringify(body).includes(FAKE), false, "키는 응답에 없다");
    assert.equal(body.settings.brain.model, "openai/gpt-4.1-mini");
    const st = await (await fetch(`${base}/status`)).json();
    assert.deepEqual([st.brain.provider, st.brain.label, st.chat], ["openrouter", "OpenRouter", true]);
    assert.equal(JSON.stringify(st).includes(FAKE), false);
    // 채팅: 공급자 접두사 모델 이름이 그대로 핸들러까지 간다
    assert.equal((await post({ text: "안녕", provider: "openrouter", model: "anthropic/claude-sonnet-4.5" })).status, 202);
    assert.deepEqual(picks.at(-1), { provider: "openrouter", model: "anthropic/claude-sonnet-4.5" });
    assert.equal((await post({ text: "안녕", provider: "openrouter", model: "no-prefix" })).status, 202, "이름표 모양은 통과하고, 맞는지는 Chat 이 본다");
    // 교체·해제
    assert.equal((await put({ brain: { keys: { openrouter: "sk-or-v1-replaced-key-000000000000" } } })).status, 200);
    assert.equal(cfg.brain.openrouterApiKey, "sk-or-v1-replaced-key-000000000000");
    assert.equal((await put({ brain: { provider: "local", keys: { openrouter: null } } })).status, 200);
    assert.equal(cfg.brain.openrouterApiKey, undefined);
    const file = JSON.parse(readFileSync(path, "utf8"));
    assert.equal(file.brain.openrouterApiKey, undefined);
    assert.equal(file.brain.geminiApiKey, "AIza-keep-1234567890", "다른 뇌 설정은 그대로");
    assert.equal(file.slackAppToken, "xapp-keep");
    const st2 = await (await fetch(`${base}/status`)).json();
    assert.deepEqual([st2.brain.provider, st2.chat], ["local", false]);
  } finally {
    bus.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("openrouter 모델 목록: 공개 GET(키 없이), 구조화 출력 지원만, 리다이렉트는 따라가지 않는다", async () => {
  const list = { data: [
    { id: "openai/gpt-4.1-mini", name: "GPT-4.1 Mini", supported_parameters: ["temperature", "structured_outputs", "tools"], architecture: { output_modalities: ["text"] } },
    { id: "some/plain-chat", name: "Plain", supported_parameters: ["temperature"] },
    { id: "some/embed", supported_parameters: ["structured_outputs"], architecture: { output_modalities: ["embeddings"] } },
    { id: " anthropic/claude-sonnet-4.5 ", supported_parameters: ["structured_outputs"] }, // 앞뒤 공백은 다듬는다
    { id: "not a model", supported_parameters: ["structured_outputs"] },
  ] };
  const f = fakeFetch(() => new Response(JSON.stringify(list), { status: 200 }));
  const rows = await openrouterModels({ fetch: f.fetch });
  assert.deepEqual(rows.map((r) => r.id), ["anthropic/claude-sonnet-4.5", "openai/gpt-4.1-mini"], "임베딩·구조화 출력 미지원·이름표 없는 id 는 뺀다");
  assert.equal(rows[1]!.label, "GPT-4.1 Mini");
  assert.equal(f.calls[0]!.url, `${OPENROUTER_URL}/models`);
  assert.equal(f.calls[0]!.init.headers?.Authorization, undefined, "공개 목록에는 키를 싣지 않는다");
  assert.equal(f.calls[0]!.init.redirect, "error");
  // 목록 실패는 그대로 알린다(빈 목록으로 숨기지 않는다)
  const bad = fakeFetch(() => new Response("busy", { status: 500 }));
  await assert.rejects(openrouterModels({ fetch: bad.fetch }), /공급자가 지금 답하지 못했어요/);
});
