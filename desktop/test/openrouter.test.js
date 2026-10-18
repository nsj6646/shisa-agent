// OpenRouter 연결: 데스크톱 IPC 경계(키 확인·목록·저장·해제·고르기). 실제 키·네트워크는 쓰지 않는다(가짜 fetch).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  checkLlm, listModels, KEY_REQ, OPENROUTER_URL, OPENROUTER_DEFAULT_MODEL, OPENROUTER_NO_CREDIT, OPENROUTER_POLICY, OPENROUTER_BAD_KEY,
} from '../src/llm-check.js';
import {
  normalizeSisa, connectedProviders, withKey, withModels, withoutProvider, daemonBrainPatch, settingsBrainBody, withDaemonBrain, KEY_PROVIDERS,
} from '../src/sisa-store.js';
import { disconnectBrainBody, withBrainBody, brainRows, brainDisconnectCopy, BRAIN_TITLE } from '../src/disconnect.js';
import { phaseAfterBrain } from '../src/setup-plan.js';
import { BRAIN_CHOICES, providerById } from '../src/ai-onboard.js';
import { sanitizeSettingsPatch, okModel } from '../src/settings.js';
import { okPickProvider, encodePick, decodePick, cleanChatModels, pickGroups, chatPickBody } from '../src/chat-pick.js';

const KEY = 'sk-or-v1-unit-test-fake-key-000000000000000000000000';
const res = (status, body) => ({ ok: status >= 200 && status < 300, status, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) });
const chat = (content) => ({ id: 'x', object: 'chat.completion', choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }] });
const err = (code, message) => ({ error: { code, message } });
const CHAT_URL = `${OPENROUTER_URL}/chat/completions`;
const MODELS_URL = `${OPENROUTER_URL}/models`;

function fake(routes) {
  const calls = [];
  const f = async (url, init = {}) => {
    calls.push({ url, init });
    const r = routes[url];
    return typeof r === 'function' ? r(init) : r;
  };
  f.calls = calls;
  return f;
}

test('openrouter 확인: 공개 모델 목록이 아니라 아주 짧은 생성 요청 한 번으로 본다', async () => {
  const f = fake({ [CHAT_URL]: res(200, chat('h')) });
  assert.deepEqual(await checkLlm('openrouter', KEY, f), { ok: true });
  assert.equal(f.calls.length, 1, '목록 조회 성공을 인증 성공으로 보지 않는다');
  assert.equal(f.calls[0].url, CHAT_URL);
  assert.equal(f.calls[0].init.headers.Authorization, `Bearer ${KEY}`);
  assert.equal(f.calls[0].init.redirect, KEY_REQ.redirect); // 리다이렉트 안 따라감
  assert.equal(f.calls[0].init.credentials, 'omit');
  const body = JSON.parse(f.calls[0].init.body);
  assert.equal(body.model, OPENROUTER_DEFAULT_MODEL);
  assert.equal(body.max_tokens, 1, '아주 작은 요청 하나 — 사용료가 들 수 있다고 안내한다');
});

test('openrouter 확인: 401 키 실패 / 402 잔액·403 정책·429 는 키 실패가 아님, 키는 글에 안 나간다', async () => {
  assert.deepEqual(await checkLlm('openrouter', KEY, fake({ [CHAT_URL]: res(401, err(401, 'No auth credentials found')) })), { ok: false, error: OPENROUTER_BAD_KEY });
  assert.deepEqual(await checkLlm('openrouter', KEY, fake({ [CHAT_URL]: res(402, err(402, 'Insufficient credits')) })), { ok: true, warn: OPENROUTER_NO_CREDIT });
  assert.deepEqual(await checkLlm('openrouter', KEY, fake({ [CHAT_URL]: res(403, err(403, 'Your account is not allowed')) })), { ok: true, warn: OPENROUTER_POLICY });
  assert.deepEqual(await checkLlm('openrouter', KEY, fake({ [CHAT_URL]: res(429, err(429, 'Rate limit exceeded')) })), { ok: true, warn: 'OpenRouter 요청이 잠깐 너무 잦았어요. 연결은 됐고, 조금 뒤엔 잘 돼요.' });
  const down = await checkLlm('openrouter', KEY, async () => { throw new Error(`fetch failed for ${KEY}`); });
  assert.equal(down.ok, false);
  assert.equal(down.error.includes(KEY), false);
});

test('openrouter 확인: HTTP 200 안의 error 봉투와 못 쓰는 모델(404)도 실패로 본다', async () => {
  // 200 + error.code 402 → 키는 맞고 크레딧만 없다고 알린다(Genspark 확인과 같은 규칙)
  assert.deepEqual(await checkLlm('openrouter', KEY, fake({ [CHAT_URL]: res(200, err(402, 'Insufficient credits')) })), { ok: true, warn: OPENROUTER_NO_CREDIT });
  // 200 + error.code 404 → 「연결됨」으로 넘기지 않는다
  const envelope = await checkLlm('openrouter', KEY, fake({ [CHAT_URL]: res(200, err(404, 'No endpoints found that support the provided parameters')) }));
  assert.equal(envelope.ok, false);
  assert.match(envelope.error, /엔드포인트.*모델 탭/);
  // HTTP 404 도 같은 이유로 알린다
  const notFound = await checkLlm('openrouter', KEY, fake({ [CHAT_URL]: res(404, err(404, 'No endpoints found that support the provided parameters')) }));
  assert.equal(notFound.ok, false);
  assert.match(notFound.error, /엔드포인트.*모델 탭/);
  // code 없이 message 만 있는 봉투도 실패로 본다
  const bare = await checkLlm('openrouter', KEY, fake({ [CHAT_URL]: res(200, { error: { message: 'Moderation blocked' } }) }));
  assert.equal(bare.ok, false);
  assert.match(bare.error, /오류가 들어 있어요/);
});

test('openrouter 목록: 공개 GET(키 안 실음), 구조화 출력 지원 모델만, 목록은 자르지 않는다', async () => {
  const many = { data: Array.from({ length: 70 }, (_, i) => ({ id: `org/model-${i}`, name: `M${i}`, supported_parameters: ['structured_outputs'] })) };
  many.data.push({ id: 'org/plain', name: 'Plain', supported_parameters: ['temperature'] });
  const f = fake({ [MODELS_URL]: res(200, many) });
  const r = await listModels('openrouter', KEY, f);
  assert.equal(r.ok, true);
  assert.equal(r.models.length, 70);
  assert.equal(r.models.some((m) => m.id === 'org/plain'), false, '구조화 출력 미지원은 채팅 후보가 아니다');
  assert.equal(f.calls[0].url, MODELS_URL);
  assert.equal(f.calls[0].init.headers?.Authorization, undefined);
  assert.equal(f.calls[0].init.redirect, KEY_REQ.redirect);
  assert.deepEqual(await listModels('openrouter', KEY, fake({ [MODELS_URL]: res(500, 'busy') })), { ok: false, error: 'OpenRouter 추론 공급자가 지금 답하지 못했어요. 조금 뒤 다시 확인해 주세요. (HTTP 500).' });
});

test('저장: 키·namespaced 모델이 앱 저장과 데몬 설정으로 그대로 가고, 해제도 안전하다', () => {
  assert.ok(KEY_PROVIDERS.includes('openrouter'));
  const pasted = withKey({}, 'openrouter', KEY);
  assert.deepEqual(connectedProviders(pasted), ['openrouter']);
  assert.deepEqual(settingsBrainBody(daemonBrainPatch(pasted)), { brain: { provider: 'openrouter', keys: { openrouter: KEY }, model: null } });
  const next = withModels(pasted, { chat: { provider: 'openrouter', model: 'anthropic/claude-sonnet-4.5' } });
  assert.equal(next.chatModels.openrouter, 'anthropic/claude-sonnet-4.5');
  assert.equal(daemonBrainPatch(next).general, 'anthropic/claude-sonnet-4.5');
  const file = withDaemonBrain({ brain: { provider: 'gemini', geminiApiKey: 'AIza-keep' }, brainModels: { gemini: { general: 'gemini-3.5-pro' } } }, daemonBrainPatch(next));
  assert.equal(file.brain.openrouterApiKey, KEY);
  assert.equal(file.brain.geminiApiKey, 'AIza-keep', '다른 뇌 키는 그대로');
  assert.equal(file.brainModels.openrouter.general, 'anthropic/claude-sonnet-4.5');
  assert.equal(file.brainModels.gemini.general, 'gemini-3.5-pro', '다른 뇌 모델은 그대로');
  assert.equal(normalizeSisa(next).chatModels.openrouter, 'anthropic/claude-sonnet-4.5');
  // 해제: 키·모델을 지우고 지금 뇌였으면 로컬로
  const off = withoutProvider(next, 'openrouter');
  assert.deepEqual(connectedProviders(off), []);
  assert.equal(off.provider, 'none');
  assert.equal(off.chatModels.openrouter, undefined);
  assert.deepEqual(disconnectBrainBody('openrouter', 'openrouter'), { brain: { provider: 'local', keys: { openrouter: null } } });
  assert.deepEqual(withBrainBody({ brain: { provider: 'openrouter', openrouterApiKey: KEY } }, { brain: { provider: 'local', keys: { openrouter: null } } }).brain, { provider: 'local' });
  assert.equal(BRAIN_TITLE.openrouter, 'OpenRouter');
  assert.match(brainDisconnectCopy('openrouter', true).note, /키를 시사에서 지워요/);
  assert.deepEqual(brainRows({ connected: [] }, { provider: 'openrouter', keys: { openrouter: true } }).map((r) => [r.id, r.active]), [['openrouter', true]]);
});

test('설치·고르기: OpenRouter 가 뇌 선택·채팅 드롭다운·세부 모델 검증에 나온다', () => {
  assert.equal(phaseAfterBrain('openrouter'), 'ai-key');
  assert.ok(BRAIN_CHOICES.some((c) => c.id === 'openrouter'));
  const p = providerById('openrouter');
  assert.equal(p.url, 'https://openrouter.ai/settings/keys');
  assert.match(p.note, /생성 요청|사용료/);
  assert.ok(p.rows.some((r) => r.keys !== undefined), '키 붙여 넣기 안내가 있다');
  // 채팅 고르기: namespaced 모델이 그대로 오간다
  assert.equal(okPickProvider('openrouter'), true);
  assert.equal(encodePick({ provider: 'openrouter', model: 'anthropic/claude-sonnet-4.5' }), 'openrouter|anthropic/claude-sonnet-4.5');
  assert.deepEqual(decodePick('openrouter|anthropic/claude-sonnet-4.5'), { provider: 'openrouter', model: 'anthropic/claude-sonnet-4.5' });
  assert.deepEqual(chatPickBody({ provider: 'openrouter', pickModel: 'anthropic/claude-sonnet-4.5' }), { provider: 'openrouter', model: 'anthropic/claude-sonnet-4.5' });
  const cleaned = cleanChatModels({ active: 'openrouter', brains: [{ provider: 'openrouter', label: 'OpenRouter', ready: true, defaults: { general: 'openai/gpt-4.1-mini' }, models: [{ id: 'anthropic/claude-sonnet-4.5', label: '' }] }] });
  assert.deepEqual(cleaned.brains[0].models.map((m) => m.id), ['anthropic/claude-sonnet-4.5']);
  const groups = pickGroups(cleaned, 'openrouter|anthropic/claude-sonnet-4.5');
  assert.ok(groups.groups[0].rows.some((r) => r.value === 'openrouter|anthropic/claude-sonnet-4.5'));
  // 세부 모델 검증: `/` 와 공급자 접두사 허용, 다른 뇌 provider 도 허용
  assert.equal(okModel('anthropic/claude-sonnet-4.5'), true);
  assert.equal(okModel('x'.repeat(80)), true);
  assert.equal(okModel('x'.repeat(101)), false, '데몬과 같은 100자 제한');
  assert.deepEqual(sanitizeSettingsPatch({ brainModels: { provider: 'openrouter', models: { general: 'anthropic/claude-sonnet-4.5' } } }), { brainModels: { provider: 'openrouter', models: { general: 'anthropic/claude-sonnet-4.5' } } });
});
