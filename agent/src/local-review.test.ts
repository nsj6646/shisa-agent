// 코드 작업 로컬 검토 정책(#3): 일반 수정 run 은 커밋·푸시·PR 없이 워크트리에 변경을 남기고 끝난다.
// 정지·실패·데몬 재시작에도 미커밋 변경을 보존하고, 완료 표시는 실제로 한 것만 말한다. PR 생성은 하드 차단.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Bus } from "./bus.ts";
import { RunRegistry } from "./runs.ts";
import { isBlockedBash, localDoneLine, noShipHook, prepareContinue, runFix } from "./fixer.ts";
import { hardDeny, type PermCtx } from "./permissions.ts";
import type { Config } from "./config.ts";
import type { Proposal } from "./store.ts";

const git = (cwd: string, ...a: string[]) => execFileSync("git", a, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const REPORT = { summary: "고쳤어요", tests_ran: "", tests_passed: true };
const author = { name: "Bot", email: "bot@example.com" };

function repoIn(root: string, name: string) {
  const seed = join(root, `${name}-seed`);
  mkdirSync(seed, { recursive: true });
  git(seed, "init", "-q", "-b", "main");
  writeFileSync(join(seed, "README.md"), "# demo\n");
  git(seed, "add", "-A");
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "init"], { cwd: seed });
  git(root, "clone", "-q", "--bare", seed, `${name}.git`);
  git(root, "clone", "-q", join(root, `${name}.git`), name);
  return join(root, name);
}
const cfgFor = (root: string) => ({ repoRoots: [root], gitAuthor: author, models: { code: "fake" } }) as unknown as Config;
const proposal = (repo: string, id: string): Proposal => ({ id, repo, title: `작업 ${id}`, plan: "p", status: "approved", created: new Date().toISOString() });
const until = async (cond: () => boolean, ms = 5000) => { const t = Date.now(); while (!cond()) { if (Date.now() - t > ms) throw new Error("timeout"); await new Promise((r) => setTimeout(r, 5)); } };

// 가짜 SDK: 한 턴 — body 를 돌고 결과 보고
function fakeSdk(body: (o: any) => Promise<void> | void) {
  return (({ prompt, options }: any) => {
    const buf: any[] = [];
    let wake: (() => void) | undefined, done = false;
    const emit = (m: any) => { buf.push(m); wake?.(); };
    (async () => {
      for await (const _m of prompt as AsyncIterable<any>) {
        emit({ type: "system", subtype: "init", session_id: options.resume ? "sess-child" : "sess-parent", model: "fake", cwd: options.cwd });
        await body(options);
        emit({ type: "result", subtype: "success", result: "done", structured_output: REPORT });
      }
      done = true; wake?.();
    })();
    return Object.assign((async function* () {
      while (true) { const m = buf.shift(); if (m) { yield m; continue; } if (done) return; await new Promise<void>((r) => { wake = r; }); wake = undefined; }
    })(), { interrupt: async () => {} });
  }) as any;
}
const writeHello = () => fakeSdk((o) => { writeFileSync(join(o.cwd, "hello.txt"), "hi\n"); });

test("일반 수정 run: 커밋·푸시·PR 없이 워크트리에 변경을 남기고, 완료 기록은 사실만 — 데몬 HTTP 로도 같은 기록", async () => {
  const root = mkdtempSync(join(tmpdir(), "cy-local-"));
  const app = repoIn(root, "app");
  const reg = new RunRegistry(new DatabaseSync(":memory:"));
  const bus = new Bus();
  await bus.listen(0, { approve: async () => "", hold: async () => "", briefing: async () => "", dashboard: async () => ({}), todoDone: () => true, chat: () => "c", chatHistory: () => [], runs: reg });
  const base = `http://127.0.0.1:${(bus.server!.address() as any).port}`;
  try {
    const r = await runFix(cfgFor(root), proposal(app, "plocal001aa"), () => {}, { query: writeHello(), runs: reg, worktreesDir: join(root, "wts") });
    assert.equal(r.ok, true, r.summary);
    // 원래 체크아웃·원격·원격 추적 참조 어디에도 흔적이 없다
    assert.equal(git(app, "status", "--porcelain"), "");
    assert.equal(git(app, "rev-list", "--count", "HEAD"), "1");
    assert.equal(git(join(root, "app.git"), "branch", "--list", "cy/*"), "");
    assert.equal(git(join(root, "app.git"), "rev-list", "--count", "--all"), "1");
    // 변경은 워크트리에 미커밋으로 남는다(브랜치도 그대로)
    assert.ok(r.worktree && existsSync(join(r.worktree, "hello.txt")));
    assert.equal(readFileSync(join(r.worktree!, "hello.txt"), "utf8"), "hi\n");
    assert.equal(git(r.worktree!, "rev-list", "--count", "HEAD"), "1");
    assert.equal(git(r.worktree!, "status", "--porcelain"), "?? hello.txt");
    assert.match(git(app, "branch", "--list", r.branch!), /cy\//);
    // 완료 문구는 실제로 한 것만 말한다(푸시·PR·머지 주장 없음)
    const line = localDoneLine(r);
    assert.match(line, /로컬 변경 완료 — 커밋·푸시·PR 없음/);
    assert.ok(line.includes(`보존된 워크트리: \`${r.worktree}\``), line);
    assert.match(line, /바뀐 파일 1개 · 테스트: 실행 안 함/);
    assert.doesNotMatch(line, /푸시 완료|PR을 올렸어요|머지/);
    // 세션 기록에도 📁 보존 줄만(🚀 푸시 완료 같은 거짓 줄 없음)
    const events = reg.getRun(r.runId!)!.events;
    assert.ok(events.some((e) => e.type === "system" && e.worktree === r.worktree && /커밋·푸시 없이 워크트리에 남겨 뒀어요/.test(e.text ?? "")));
    assert.equal(events.some((e) => /푸시 완료|PR을 올렸어요|PR 생성했|머지할까요/.test(e.text ?? "")), false);
    // 데몬 HTTP 로도 같은 run·이벤트가 보인다
    const one = await (await fetch(`${base}/runs/${r.runId}`)).json();
    assert.equal(one.run.status, "done");
    assert.ok((one.events as any[]).some((e) => e.worktree === r.worktree && /남겨 뒀어요/.test(e.text ?? "")));
  } finally { bus.close(); }
});

test("테스트 실패·정지에도 검증 완료로 표시하지 않고 미커밋 변경을 보존한다", async () => {
  const root = mkdtempSync(join(tmpdir(), "cy-local-keep-"));
  const app = repoIn(root, "app");
  const reg = new RunRegistry(new DatabaseSync(":memory:"));
  const save = writeHello();
  const fail = Object.assign(new Error("exit 1"), { stderr: "boom" });
  const r = await runFix(cfgFor(root), proposal(app, "plocal002bb"), () => {},
    { query: save, runs: reg, worktreesDir: join(root, "wts"), testCommands: [{ label: "unit", cmd: ["npm", "test"], dir: "." }], runTest: async () => { throw fail; } });
  assert.equal(r.ok, false);
  assert.match(r.summary, /테스트 실패/);
  assert.ok(r.worktree && existsSync(join(r.worktree, "hello.txt"))); // 실패해도 변경이 있는 워크트리는 지우지 않는다
  assert.equal(reg.getRun(r.runId!)!.run.status, "failed");

  // 정지: 돌다가 멈춰도 남긴 변경은 그대로
  let release!: () => void;
  const gate = new Promise<void>((res) => { release = res; });
  const slow = fakeSdk(async (o) => { writeFileSync(join(o.cwd, "slow.txt"), "x\n"); await gate; });
  const p = runFix(cfgFor(root), proposal(app, "plocal003cc"), () => {}, { query: slow, runs: reg, worktreesDir: join(root, "wts") });
  await until(() => reg.listRuns({ status: "running" }).length === 1);
  const id = reg.listRuns({ status: "running" })[0].id;
  await reg.stop(id);
  release();
  const stopped = await p;
  assert.equal(stopped.ok, false);
  assert.match(stopped.summary, /정지/);
  const wt = reg.summary(id)!.cwd!;
  assert.ok(existsSync(join(wt, "slow.txt")));
  assert.match(git(app, "branch", "--list", reg.summary(id)!.branch!), /cy\//);
  assert.equal(git(join(root, "app.git"), "branch", "--list", "cy/*"), "");
});

test("데몬 재시작: 돌던 run 은 failed 로 닫히고, 남은 워크트리에서 이어서 한다(원격·PR 없이)", async () => {
  const root = mkdtempSync(join(tmpdir(), "cy-local-restart-"));
  const app = repoIn(root, "app");
  const dbFile = join(root, "cy.db");
  const reg1 = new RunRegistry(new DatabaseSync(dbFile));
  let release!: () => void;
  const gate = new Promise<void>((res) => { release = res; });
  const sdk = fakeSdk(async (o) => { writeFileSync(join(o.cwd, "before.txt"), "1\n"); await gate; });
  const p = runFix(cfgFor(root), proposal(app, "plocal004dd"), () => {}, { query: sdk, runs: reg1, worktreesDir: join(root, "wts") });
  await until(() => reg1.listRuns({ status: "running" }).length === 1);
  const id = reg1.listRuns({ status: "running" })[0].id;
  const wt = reg1.summary(id)!.cwd!;
  assert.ok(existsSync(wt));
  // 데몬 재시작: 같은 DB 로 새 레지스트리 — 돌던 run 은 failed 로 닫히고 워크트리는 디스크에 그대로
  const reg2 = new RunRegistry(new DatabaseSync(dbFile));
  assert.equal(reg2.summary(id)!.status, "failed");
  release();
  await p;
  assert.ok(existsSync(join(wt, "before.txt"))); // 재시작·정리에도 지워지지 않았다

  // 이어 하기: 보존된 워크트리에서 이어서 하고, PR·푸시는 없다
  const c = prepareContinue(cfgFor(root), {
    parent: reg2.summary(id)!, repo: app, branch: reg2.summary(id)!.branch!, text: "이어서 고쳐", summary: "앞선 작업",
  }, { runs: reg2, worktreesDir: join(root, "wts"), query: fakeSdk((o) => { writeFileSync(join(o.cwd, "after.txt"), "2\n"); }), sessionExists: async () => false });
  const cid = c.run.id;
  const out = await c.start(() => {});
  assert.equal(out.ok, true, out.summary);
  assert.equal(reg2.summary(cid)!.cwd, wt); // 같은 보존 워크트리에서 이어서
  assert.ok(existsSync(join(wt, "before.txt")) && existsSync(join(wt, "after.txt")));
  assert.equal(git(join(root, "app.git"), "branch", "--list", "cy/*"), "");
});

test("PR 생성은 하드 차단(승인·자동 머지로도 안 풀림), PR 읽기·git 읽기는 그대로", async () => {
  const ctx: PermCtx = { roots: ["/h/code"], brainDir: "/h/.cy-agent/brain", cwd: "/h/code/app", home: "/h", cyHome: "/h/.cy-agent" };
  for (const cmd of ["gh pr create --fill", "gh -R owner/repo pr create", "\"gh\" pr create", "sudo gh pr create", "gh api -X POST repos/o/r/pulls", "gh api --method=POST repos/o/r/pulls", "gh api repos/o/r/pulls -f title=x"]) {
    const v = hardDeny("Bash", { command: cmd }, ctx);
    assert.equal(v.allow, false, cmd);
    assert.match((v as any).reason, /PR 생성/, cmd);
    assert.equal(isBlockedBash(cmd), true, cmd); // 수정 run 훅도 같은 명령을 막는다
    const r: any = await noShipHook({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: cmd } } as any, "t", {} as any);
    assert.equal(r.hookSpecificOutput?.permissionDecision, "deny", cmd);
  }
  for (const cmd of ["gh pr view 1", "gh pr list", "gh api repos/o/r/pulls", "gh api repos/o/r/pulls/1", "git status", "git diff", "npm test"]) {
    assert.equal(hardDeny("Bash", { command: cmd }, ctx).allow, true, cmd);
    assert.equal(isBlockedBash(cmd), false, cmd);
  }
});
