// pi 도구 승인 규칙(permissions.ts decidePi): 셸은 읽기처럼 보여도 늘 카드, 하드 차단은 승인·force 와 무관하게 유지.
// 파일 도구는 시사 코드 작업 쪽(core.approvePiTool)이 작업 폴더 안/밖을 가른 뒤 이 판정을 부른다.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Store } from "./store.ts";
import { PermissionBroker, PermissionRules, type PermCtx, type PermDecision, type PermOrigin, type PermRequest } from "./permissions.ts";

const origin: PermOrigin = { via: "chat" };
const ctx = (cwd = "/repo/wt", localAuto = true): PermCtx => ({ roots: ["/repo"], brainDir: "/home/u/.cy-agent/brain", cwd, localAuto, worktrees: [cwd] });

class FakeQueue {
  requests: PermRequest[] = [];
  private waits: ((d: PermDecision) => void)[] = [];
  requestPermission(req: PermRequest, signal?: AbortSignal) {
    this.requests.push(req);
    let resolve!: (d: PermDecision) => void;
    const decision = new Promise<PermDecision>((r) => { resolve = r; });
    this.waits.push(resolve);
    signal?.addEventListener("abort", () => resolve({ behavior: "deny", message: "취소" }), { once: true });
    return { action: { id: "a" } as any, decision };
  }
  answer(d: PermDecision) { this.waits.shift()!(d); }
}

function make() {
  const store = new Store(":memory:");
  const rules = new PermissionRules(store);
  const q = new FakeQueue();
  return { broker: new PermissionBroker(rules, q as any), q, rules };
}

test("pi 셸: localAuto·기억된 규칙이 있어도 늘 승인 카드, 답이 allow 여야 실행된다", async () => {
  const { broker, q, rules } = make();
  rules.add({ tool: "Bash", scope: "npm test", label: "npm test" }); // 기억된 [항상 허용] 규칙
  const p = broker.decidePi("Bash", { command: "npm test" }, origin, ctx(), true);
  assert.equal(q.requests.length, 1, "규칙·localAuto 를 건너뛰고 카드");
  assert.equal(q.requests[0].toolName, "Bash");
  q.answer({ behavior: "allow", always: false });
  assert.deepEqual(await p, { behavior: "allow", always: false });
  assert.equal(rules.list().length, 1, "force 카드는 새 규칙을 저장하지 않는다");
});

test("pi 하드 차단: 승인 카드 없이 거부, force 로도 풀리지 않는다", async () => {
  const { broker, q } = make();
  for (const command of ["git push origin main", "gh pr create --fill", "cat ~/.cy-agent/config.json"]) {
    const d = await broker.decidePi("Bash", { command }, origin, ctx(), true);
    assert.equal(d.behavior, "deny", `${command} 은 하드 차단`);
  }
  assert.equal(q.requests.length, 0, "카드 자체를 띄우지 않는다");
});

test("pi 읽기처럼 보이는 셸·거부 이유 전달", async () => {
  const { broker, q } = make();
  const p = broker.decidePi("Bash", { command: "ls" }, origin, ctx(), true);
  assert.equal(q.requests.length, 1, "ls 도 승인 카드(읽기 자동 허용 예외 없음)");
  q.answer({ behavior: "deny", message: "사용자가 거부했어요" });
  assert.deepEqual(await p, { behavior: "deny", message: "사용자가 거부했어요" });
});

test("pi 파일 도구: 허용 범위 읽기는 묻지 않고, 비밀 파일은 하드 차단", async () => {
  const { broker, q } = make();
  assert.deepEqual(await broker.decidePi("Read", { file_path: "/repo/wt/src/a.ts" }, origin, ctx("/repo/wt", false), false), { behavior: "allow", always: false });
  assert.equal(q.requests.length, 0, "작업 폴더 안 읽기는 카드 없이");
  const secret = await broker.decidePi("Read", { file_path: "/repo/wt/.env" }, origin, ctx(), false);
  assert.equal(secret.behavior, "deny");
  assert.match((secret as any).message, /차단/);
  assert.equal(q.requests.length, 0);
});

// 코어 경로(Agent.approvePiTool): 시사의 기존 승인 카드(SSE action)·하드 차단·작업 범위를 그대로 지나는지
test("pi 코어 판정: 작업 폴더 안 수정은 카드 없이, 셸·폴더 밖은 승인 카드, 하드 차단은 카드 없이 거부", async () => {
  const { Agent } = await import("./core.ts");
  const { Bus } = await import("./bus.ts");
  const { loadConfig } = await import("./config.ts");
  const { RunRegistry } = await import("./runs.ts");
  const { DatabaseSync } = await import("node:sqlite");
  const { mkdtempSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");

  const wt = mkdtempSync(join(tmpdir(), "cy-pi-core-"));
  try {
    const store = new Store(":memory:");
    const bus = new Bus();
    bus.setMood = () => {};
    const sse: any[] = [];
    (bus as any).send = (event: string, data: unknown) => sse.push([event, data]);
    const cfg = { ...loadConfig(), repoRoots: [wt], claudeProjectsDir: "/none", codexSessionsDir: "/none" };
    const agent = new Agent(cfg, store, bus, undefined, {
      useBroker: false, git: async () => [],
      actions: { now: () => new Date(), runs: new RunRegistry(new DatabaseSync(":memory:")), execute: async () => ({ called: false }) },
      think: (async () => { throw new Error("no"); }) as any,
    });
    const approve = (name: string, input: Record<string, unknown>) => (agent as any).approvePiTool({ name, input, cwd: wt }, origin);
    const waitCard = async (): Promise<any> => {
      for (let k = 0; k < 200; k++) { const a = sse.find(([e, d]) => e === "action" && d.action.status === "pending"); if (a) return a[1].action; await new Promise((r) => setTimeout(r, 2)); }
      throw new Error("카드가 안 떴어요");
    };

    // 작업 폴더 안 수정·읽기: 승인 카드 없이 바로
    assert.deepEqual(await approve("edit", { path: join(wt, "src/a.ts"), edits: [] }), { allow: true });
    assert.deepEqual(await approve("read", { path: join(wt, "package.json") }), { allow: true });
    assert.equal(sse.length, 0, "반복 승인창 없음");

    // 셸: 카드가 뜨고, 허용해야 실행된다. [항상 허용]은 붙지 않는다
    const shell = approve("bash", { command: "npm test" });
    const card = await waitCard();
    assert.equal(card.type, "tool_permission");
    assert.equal(card.toolName, "Bash");
    assert.equal(card.card.fields[0].value, wt, "카드에 대상 작업 폴더");
    assert.equal(card.card.body, "npm test", "카드에 명령");
    assert.equal(card.card.always, undefined, "pi 셸에는 [항상 허용] 없음");
    await agent.confirmAction(card.id);
    assert.deepEqual(await shell, { allow: true });
    assert.deepEqual((agent as any).permissionRules.list(), [], "규칙이 저장되지 않는다");

    // 거부: 실행하지 않고 이유를 모델에 전한다
    sse.length = 0;
    const denied = approve("bash", { command: "rm -rf node_modules" });
    await agent.cancelAction((await waitCard()).id);
    const d = await denied;
    assert.equal(d.allow, false);
    assert.match(String(d.reason), /거부/);

    // 작업 폴더 밖 파일: 카드
    sse.length = 0;
    const outside = approve("write", { path: join(tmpdir(), `cy-out-${Date.now()}.txt`) });
    const outCard = await waitCard();
    assert.match(outCard.card.fields[0].value, /cy-out-/);
    await agent.cancelAction(outCard.id);
    assert.equal((await outside).allow, false);

    // ~ · @ 로 시작하는 경로도 pi 는 펴서 쓴다(path-utils) — 작업 폴더 안으로 오해하면 안 된다
    for (const escape of ["~/cy-agent-escape-test.txt", "@/etc/hosts", "~\\cy-agent-escape-test.txt"]) {
      sse.length = 0;
      const p = approve("write", { path: escape });
      const c = await waitCard();
      assert.equal(c.type, "tool_permission", `${escape} 는 작업 폴더 밖 카드`);
      await agent.cancelAction(c.id);
      assert.equal((await p).allow, false);
    }

    // 하드 차단·모르는 도구: 카드 자체를 띄우지 않는다
    sse.length = 0;
    assert.equal((await approve("bash", { command: "gh pr create --fill" })).allow, false);
    assert.equal((await approve("bash", { command: "cat ~/.cy-agent/config.json" })).allow, false);
    assert.equal((await approve("webfetch", { url: "https://x" })).allow, false);
    assert.equal(sse.length, 0, "하드 차단은 승인해도 안 된다");
  } finally { rmSync(wt, { recursive: true, force: true }); }
});
