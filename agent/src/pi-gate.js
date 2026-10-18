// 시사가 띄운 pi(RPC) 안에서 도는 도구 승인 창구. 시사가 -e 로만 싣는다(개인 확장·MCP 는 --no-extensions 로 끈다).
// 모든 도구 호출을 그대로 시사에 물어보고, "허용" 답을 받은 것만 실행한다. 답이 없거나 이상하면 막는다(안전한 쪽으로).
//  - 시사는 이 요청을 보고 셸이면 늘 승인 카드를, 파일 도구면 규칙(작업 폴더 안 수정·허용된 읽기)대로 답한다.
//  - 비밀 가리기·하드 차단·작업 범위 판정은 전부 시사 몫이다(여기엔 판정을 두지 않는다 — 한 곳에서만).
// import 없이 돈다(pi 프로세스 안에서 시사의 node_modules 를 쓰지 않는다).
export default function (pi) {
  pi.on("tool_call", async (event, ctx) => {
    const deny = (reason) => ({ block: true, reason: `시사: ${reason}` });
    if (!ctx.hasUI) return deny("승인 창구가 없어 실행하지 않았어요");
    const ask = JSON.stringify({ tool: String(event.toolName ?? ""), input: event.input && typeof event.input === "object" ? event.input : {} });
    let answer;
    try { answer = await ctx.ui.input("shisa-tool", ask); } catch { answer = undefined; }
    let d;
    try { d = JSON.parse(answer); } catch { d = undefined; }
    if (!d || d.allow !== true) return deny(typeof d?.reason === "string" && d.reason ? d.reason : "승인되지 않았어요");
    return undefined;
  });
}
