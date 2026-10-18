# OpenRouter 연결 가능성 조사

- 조사일: 2026-10-18 (KST)
- 코드 기준: `88b5631`
- 상태: 조사·명세·구현 티켓 게시 완료. T1(#2 OpenRouter 대화·브리핑)은 구현·테스트를 마쳤다. 아래 조사 기록은 명세의 배경 자료다.
- 확정 명세: [GitHub Issue #1 — OpenRouter 뇌와 pi 코드 작업 지원](https://github.com/nsj6646/shisa-agent/issues/1) (`ready-for-agent`).
- 요구사항 정정: 사용자는 Claude Code/Codex를 사용하거나 구독하지 않는다. OpenRouter 및 기존에 사용하는 Zed·pi로 대체할 수 있는지가 조사 대상이다. 기존 실행기를 유지하는 것은 전제가 아니다.

## 결론

**OpenRouter를 기존 AI들과 나란히 선택하는 대화·브리핑용 뇌로 추가할 수 있다.** 기존 OpenAI/Genspark의 Chat Completions HTTP 경로를 재사용하는 것이 가장 작은 변경이다. 새 SDK나 서버는 필요하지 않다.

**현재 설정만으로는 사용할 수 없다.** 공급자 허용 목록에 `openrouter`가 없고, OpenAI 요청 주소는 `https://api.openai.com/v1/chat/completions`로 고정돼 있다. OpenRouter 키를 OpenAI 키 칸에 넣거나 임의의 base URL 설정을 추가하는 방법은 현재 지원하지 않는다. [코드: config](../agent/src/config.ts), [providers](../agent/src/providers.ts), [앱 저장](../desktop/src/sisa-store.js)

OpenRouter를 뇌로 추가하는 것과 MCP·코드 수정 실행기를 OpenRouter로 교체하는 것은 별개다. OpenRouter API 자체의 도구 지원 여부와 무관하게, 이 프로젝트의 HTTP 뇌 경로에는 도구 실행 루프가 없다. [코드: brain](../agent/src/brain.ts), [feature-brain](../agent/src/feature-brain.ts), [coding](../agent/src/coding.ts)

## 사용자와 확정한 방향

- Claude Code/Codex 사용·구독을 전제로 하지 않는다. Zed는 편집기로 유지한다.
- 기존 API형 뇌/코드 실행기 분리를 따라, 대화·브리핑은 OpenRouter 직접 호출, 코드 작업은 pi + OpenRouter로 연결한다. 현재 프로젝트가 이미 OpenRouter/pi를 지원한다는 뜻은 아니다.
- 첫 구현 범위는 대화·브리핑·pi 코드 수정이다. 과거 pi 작업 기록 수집·MCP 업무 도구·지식그래프 자동 학습은 후속 범위로 분리한다.
- 코드 작업은 별도 워크트리에서 수정·테스트한 뒤 변경과 결과를 보여 준다. 기본 동작에서 자동 커밋·푸시하지 않는다.
- 커밋·푸시는 별도 요청 시에만 다루며, **PR은 앞으로도 생성하지 않는다.** 커밋·푸시를 허용하더라도 PR 생성으로 이어지지 않는다.
- OpenRouter 키는 시사 설정에서 한 번 등록하여 대화와 pi 코드 작업에 함께 사용한다. 개인 pi 인증·설정 파일은 변경하지 않는다.
- 기존 세부 모델 설정을 활용해 대화·브리핑용 모델과 pi 코드 작업용 모델을 각각 선택한다. 같은 모델을 선택해도 된다.
- 시사용 pi 실행에서는 개인 확장·MCP를 자동으로 불러오지 않는다. 워크트리 파일 수정은 허용하되 모델이 요청하는 셸 명령은 실행 전 승인을 받는다. 기존 비밀 보호·위험 명령 차단을 유지하며 PR 생성은 승인해도 차단한다.
- 위 권한 정책은 OS 샌드박스를 보장하는 것은 아니다.
- 사용자가 위 추천안, 테스트 경계(데몬 HTTP/SSE, 데스크톱 IPC), T1~T5 티켓 분할과 선행 관계를 승인했다. 명세 #1의 하위 이슈로 게시하고 본문·라벨·선행 관계를 검증했다. 부모 명세의 본문·상태는 변경하지 않았다.

## 구현 티켓

각 티켓은 `ready-for-agent`이며, 선행 이슈가 모두 완료된 티켓부터 진행한다. T1(#2)은 구현·테스트를 마쳤다. 다음은 T2(#3)부터다. PR 은 만들지 않는다.

| 제안 번호 | 게시된 이슈 | 선행 이슈 |
| --- | --- | --- |
| T1 | [#2 — OpenRouter로 대화·브리핑 사용](https://github.com/nsj6646/shisa-agent/issues/2) | 없음 |
| T2 | [#3 — 코드 작업을 로컬 검토형으로 전환하고 PR 생성 차단](https://github.com/nsj6646/shisa-agent/issues/3) | 없음 |
| T3 | [#4 — 승인 기반 pi 코드 작업 실행](https://github.com/nsj6646/shisa-agent/issues/4) | #2, #3 |
| T4 | [#5 — pi 작업에 추가 지시하고 안전하게 이어 하기](https://github.com/nsj6646/shisa-agent/issues/5) | #4 |
| T5 | [#6 — 명시적으로 요청한 커밋·푸시만 수행](https://github.com/nsj6646/shisa-agent/issues/6) | #3 |

하위 이슈와 의존성은 GitHub 네이티브 관계로 설정했다. 티켓 본문·완료 조건의 원본은 GitHub 이슈이며, 위 표는 게시 시점의 탐색용 링크다.

현재 `fixer.ts`는 테스트 뒤 자동 커밋·푸시·PR 생성을 실행하고, `core.ts`·`followup.ts`는 PR이 없어도 성공을 「푸시 완료」로 표시한다. 사용자 방향을 구현할 때 실행·이어 하기·완료 표시·프롬프트·테스트를 함께 바꿔야 한다. 로컬 미커밋 변경이 있는 워크트리를 보존하고, 이어 할 때 원격 브랜치가 없다는 이유로 그 변경을 버리지 않아야 한다. [fixer](../agent/src/fixer.ts), [core](../agent/src/core.ts), [followup](../agent/src/followup.ts), [워크트리 보존](../agent/src/worktree-keep.ts)

## 추가 결론: Claude Code/Codex 없이 Zed·pi로 사용하기

**구독 없이 사용하는 구성을 만들 수 있다. 다만 현재 시사의 설정 파일만 바꿔 pi나 Zed를 선택할 수는 없다.** 시사에는 이 둘을 실행기로 지원하는 구현이 없으며, 코드 작업 실행기 허용 목록은 Claude Code/Codex뿐이다. [coding](../agent/src/coding.ts), [config](../agent/src/config.ts), [앱 실행기 감지](../desktop/src/agent-login.js)

### pi는 실행기 대체 후보가 된다

설치된 공식 `@earendil-works/pi-coding-agent` 1.3.0의 문서와 예제로 다음을 확인했다.

- OpenRouter는 기본 공급자다. `/login openrouter` 또는 `OPENROUTER_API_KEY`를 사용할 수 있다. Claude Code/Codex 구독은 이 연결의 요건이 아니다. OpenRouter 모델 사용료는 별개다. [공식 Providers](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/providers.md)
- TypeScript SDK는 작업 폴더·모델·도구를 지정하고, 프롬프트를 보내며, 도구 실행 이벤트를 받거나 작업을 중지할 수 있다. [공식 SDK](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md), [도구 선택 예제](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/examples/sdk/05-tools.ts)
- RPC는 pi를 하위 프로세스로 실행해 JSONL 명령·이벤트로 제어하는 공식 경로다. 프롬프트·추가 지시·취소·모델 변경·완료 확인을 연결할 수 있다. 단순 `pi -p`보다 대화형 작업 세션에 적합한 후보이며, 인프로세스 SDK도 대안이다. [공식 RPC](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/rpc.md), [RPC 예제](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/examples/rpc-client.ts)
- 현재 버전은 stdio/HTTP MCP도 지원한다. 그러나 시사의 로컬 맥락 도구와 승인 처리가 자동으로 pi에 옮겨지는 것은 아니다. SDK 사용 시 MCP 확장을 명시적으로 연결해야 한다. [공식 MCP](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/mcp.md), [SDK MCP 예제](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/examples/sdk/14-codemode-mcp.ts)

프로젝트에는 이미 Codex 이벤트를 기존 실행 기록 형식으로 바꾸는 adapter가 있다. pi도 이와 유사한 연결 지점에 붙일 수 있다. 다만 이벤트 형식, 도구명, 작업 결과 JSON, 중지·추가 지시·이어 하기, 모델 선택·준비 상태·화면 분기를 함께 처리해야 하므로 명령 이름만 바꾸는 작업은 아니다. [Codex adapter](../agent/src/codex-coder.ts), [수정 실행](../agent/src/fixer.ts), [실행 기록](../agent/src/runs.ts)

### 기능별로 필요한 변경은 다르다

| 원하는 것 | 현 상태 | 가능한 접근 |
| --- | --- | --- |
| 시사 대화·브리핑을 OpenRouter로 사용 | 미지원 | 앞서 조사한 HTTP 뇌 추가. pi가 반드시 필요한 것은 아님 |
| 시사가 코드 작업을 pi에 맡김 | 미지원 | pi SDK/RPC 실행기 adapter 추가, 기존 워크트리·테스트·작업 기록 연결. 합의에 따라 자동 Git 작업·PR 생성은 제거 |
| 자동 진척 판정·프로필 학습·지식그래프를 구독 없이 실행 | Claude Code/Codex 뇌로 제한 | 모델 호출 경로와 기능 게이트를 확장. OpenRouter HTTP 호출 또는 pi 활용을 비교해야 함 |
| pi의 MCP로 시사에서 업무 도구 사용 | 자동 연결 안 됨 | MCP 허용 목록·로컬 맥락 도구·승인 처리를 pi에 연결 |
| 기존 pi 작업 기록을 시사가 읽고 정리 | 미지원 | pi 세션 형식용 수집기 추가 및 명시적 읽기 동의 필요 |
| Zed에서 OpenRouter 또는 pi 사용 | Zed 자체가 지원 | Zed 설정에서 가능. 시사 연동과는 별도 |

자동 진척 판정·학습은 제품 구독이 기술적으로 필수라서 막힌 것이 아니라, 현재 코드가 해당 실행 경로만 지원하기 때문에 막혀 있다. 이를 OpenRouter로 확장하려면 단순히 기능 게이트를 열지 말고 각 호출·검증·오류 처리까지 연결해야 한다. [feature-brain](../agent/src/feature-brain.ts), [학습](../agent/src/profile.ts), [진척 판정](../agent/src/todo-progress.ts), [KG 추출](../agent/src/kg/extract.ts)

현재 세션 수집기도 Claude Code/Codex 형식만 지원한다. pi를 새 작업 실행기로 붙이는 것과, 사용자가 별도로 수행한 pi 작업 기록을 수집하는 것은 별개 범위다. [현재 수집기](../agent/src/ingest/sessions.ts)

### Zed는 편집기·ACP 클라이언트로 구분한다

Zed는 OpenRouter 키를 모델 접근에 사용하고, ACP Registry의 외부 에이전트로 Pi Coding Agent를 사용할 수 있다고 공식 문서에 명시한다. 이 경우 pi의 공급자 인증·모델·도구 설정은 pi 측에서 관리한다. Zed의 자체 LLM 설정이 외부 에이전트 설정이나 시사 설정을 자동으로 바꾸지는 않는다. [Zed OpenRouter](https://zed.dev/docs/ai/use-a-gateway#openrouter), [Zed 외부 에이전트](https://zed.dev/docs/ai/external-agents#pi)

이는 **Zed가 pi를 호출하는 방향**이다. 조사한 Zed CLI와 외부 에이전트 문서에서는 **시사가 Zed 자체를 headless 코드 수정 실행기로 호출하고 결과를 회수하는 공식 interface**를 확인하지 못했다. 따라서 이 방향을 설정만으로 가능하다고 약속하지 않는다. Zed는 편집·검토 화면으로 유지하고 시사는 pi를 직접 호출하는 구성이 더 명확하다. [Zed CLI](https://zed.dev/docs/reference/cli), [Zed 외부 에이전트](https://zed.dev/docs/ai/external-agents)

### 안전성과 검증 한계

pi의 기본 도구는 실행 사용자 권한으로 동작하며, 작업 폴더 지정이나 git 워크트리만으로 다른 폴더·네트워크 접근이 차단되지는 않는다. 현재 시사의 승인·비밀 보호·배포 명령 차단을 보존하고, 필요한 격리를 결정해야 한다. 단순한 pi 프로세스 실행만으로 기존 Codex 샌드박스와 같은 안전성을 보장할 수 없다. [pi 보안](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/security.md), [격리 방식](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/containerization.md), [현재 Codex 안전장치](../agent/src/codex-coder.ts)

이 추가 조사는 공식 문서·예제와 현재 코드의 대응을 확인한 것이다. pi/Zed 연동 코드는 작성하지 않았고, 실제 모델 요청·MCP 연결·자동 파일 수정은 실행하지 않았다. 아래 기존 테스트 결과는 pi 연동 검증 결과가 아니다.

## 조사 범위

전체 파일 목록, 운영 코드 모듈의 역할·공개 심벌, README·연결 문서·HTTP/SSE 계약·배포 문서를 통해 전체 구조를 파악했다. AI 호출·설정·키 저장·모델 선택·연결 해제·상태 표시와 연결된 소스 및 관련 테스트를 중점적으로 읽었다.

저장소의 모든 구현·테스트 줄을 정독한 전수 감사는 아니다. 캐릭터 이미지·영상, 외부 의존성 소스, 모든 비관련 구현의 상세 검증은 하지 않았다.

## 프로젝트 구조와 호출 경로

```text
Electron 렌더러(캐릭터·패널·설정)
  → preload IPC
  → desktop/main.js
  → 로컬 HTTP/SSE 데몬(127.0.0.1:47823)
  → agent/src/chat.ts / core.ts
  → brain.ts ask()
      ├─ claude-code: Claude Agent SDK + 도구·승인 처리
      └─ HTTP 뇌: providers.ts → JSON 응답 → 기존 기능에 적용
```

- `agent/`: Node.js로 TypeScript를 직접 실행한다. 수집·브리핑·채팅·스케줄·로컬 HTTP 서버를 담당한다. [main](../agent/src/main.ts), [core](../agent/src/core.ts), [의존성](../agent/package.json)
- `desktop/`: Electron 메인이 네트워크를 담당하고 렌더러는 IPC를 사용한다. [main](../desktop/main.js), [데몬 계약](contract.md)
- 할 일·프로젝트·대화·지식그래프 등은 `node:sqlite`의 `cy.db`에 저장한다. [store](../agent/src/store.ts)
- AI 연결 정보는 앱의 `sisa-ai.json`과 데몬의 `~/.cy-agent/config.json`에 반영된다. 기존 저장·전환·연결 해제 경로를 모두 따라야 한다. [앱 저장](../desktop/src/sisa-store.js), [설정](../agent/src/settings.ts), [연결 해제](../desktop/src/disconnect.js)
- 코드 수정은 대화용 `brain.provider`와 별도인 `coding.provider`로 Claude Code 또는 Codex를 선택한다. 일부 설명 문서는 Claude Code 전용이라고 적지만 현재 구현은 Codex도 지원한다. [coding](../agent/src/coding.ts), [fixer](../agent/src/fixer.ts)

## OpenRouter 공식 API와의 대응

| 항목 | 확인 결과 | 근거 |
| --- | --- | --- |
| 대화 주소 | `POST https://openrouter.ai/api/v1/chat/completions` | [인증 문서](https://openrouter.ai/docs/api/reference/authentication) |
| 인증 | `Authorization: Bearer <키>` | [인증 문서](https://openrouter.ai/docs/api/reference/authentication) |
| 응답 | `choices[0].message.content`를 사용하는 기존 경로와 대응 | [구조화 출력 예제](https://openrouter.ai/docs/guides/features/structured-outputs) |
| JSON 스키마 | 지원 모델·엔드포인트에서 `response_format.type = json_schema` 사용 가능 | [구조화 출력](https://openrouter.ai/docs/guides/features/structured-outputs) |
| 모델 목록 | `GET /api/v1/models`, 모델 ID·지원 파라미터·입출력 형식·가격 등 제공 | [모델 목록 API](https://openrouter.ai/docs/api/api-reference/models/list-all-models-and-their-properties) |
| 라우팅 제약 | `provider.require_parameters: true`로 요청 파라미터를 지원하지 않는 엔드포인트 제외 | [공급자 라우팅](https://openrouter.ai/docs/guides/routing/provider-selection) |

공개 모델 목록을 **키 없이 실제 GET**하여 HTTP 200을 확인했다. 조사 시점 응답에는 471개 모델이 있었고 그중 391개가 `structured_outputs`를 표기했다. `openai/gpt-4.1-mini`도 목록과 지원 파라미터에 존재했다. 모델 목록과 지원 여부는 바뀌므로 이 숫자나 이름을 영구 보장하면 안 된다. 이 GET은 인증·크레딧·모델 추론 성공을 검증한 것이 아니다. [실제 조회 주소](https://openrouter.ai/api/v1/models)

## 그대로 재사용할 부분

`agent/src/providers.ts`의 `chatCompletionsText()`는 이미 OpenAI와 Genspark가 함께 사용한다. Bearer 인증, 시스템/사용자 메시지, JSON 스키마, 타임아웃, 취소, 재시도, 리다이렉트 차단이 있다. `openaiStrict()`와 `openaiUnstrict()`는 선택 필드의 생략과 명시적 null의 의미를 보존한다. OpenRouter에도 이 경로를 기반으로 필요한 차이만 추가하는 것이 적절하다. [providers](../agent/src/providers.ts), [strict 테스트](../agent/src/openai-strict.test.ts), [Genspark 테스트](../agent/src/genspark.test.ts)

## 구현할 때 반드시 처리할 차이

1. **일반 대화도 구조화 출력이다.** `CHAT_SCHEMA`는 답 글 외에 할 일·프로젝트·화면 전환 등을 포함한다. 단순 문자열 대답만 성공해도 완전한 연결은 아니다. 지원 모델을 확인하고 `provider.require_parameters: true`를 사용해야 한다. 단, 공식 문서도 공급자별 스키마 강제 수준 차이를 명시하므로 앱의 실제 스키마로 검증해야 한다. [chat](../agent/src/chat.ts), [공식 구조화 출력](https://openrouter.ai/docs/guides/features/structured-outputs)
2. **모델 ID에 `/`가 들어간다.** 채팅·앱 저장·데몬의 모델명 형식은 이미 이를 허용하지만 설정 창 `desktop/src/settings.js`의 `okModel()`은 허용하지 않는다. 새 공급자 허용 목록뿐 아니라 세부 모델 저장 검증도 고쳐야 한다. 읽기 전용 assert로 이 차이를 재현했다. [설정 창 검증](../desktop/src/settings.js), [채팅 선택](../desktop/src/chat-pick.js), [데몬 모델](../agent/src/models.ts)
3. **키 검증과 모델 조회를 구분한다.** 공개 모델 목록 조회 성공만으로 키가 맞다고 표시하면 안 된다. 인증이 필요한 조회 또는 작은 생성 요청을 별도로 검증해야 하며, 생성 검증에는 비용이 발생할 수 있다. [실제 공개 목록](https://openrouter.ai/api/v1/models), [현재 앱 연결 확인](../desktop/src/llm-check.js)
4. **403은 무조건 잘못된 키가 아니다.** 현재 공통 처리는 401·403을 잘못된 키로 기억한다. OpenRouter는 403에 권한·예산·정책 차단을 포함하므로 이를 그대로 적용하면 정상 키로도 이후 정기 브리핑을 멈출 수 있다. 401 인증 오류, 402 잔액/예산 관련 오류, 403 정책/권한 오류, 429 제한 등을 구분해야 한다. [현재 처리](../agent/src/providers.ts), [브리핑 중단](../agent/src/main.ts), [공식 오류 문서](https://openrouter.ai/docs/api/reference/errors-and-debugging)
5. **HTTP 200의 오류 본문도 검사한다.** OpenRouter는 비스트리밍에서도 HTTP 200에 `error`만 반환할 수 있다. 현재 공통 helper는 `choices`를 주로 읽으므로, 이를 단순 JSON 파싱 실패로 숨기지 않도록 처리해야 한다. [현재 helper](../agent/src/providers.ts), [공식 오류 문서](https://openrouter.ai/docs/api/reference/errors-and-debugging#non-streaming-requests)
6. **데이터 전송과 비용을 명시한다.** HTTP 뇌는 로컬에 수집한 할 일·일정·메일·허용된 작업 기록 등을 프롬프트에 넣는다. OpenRouter 연결 시 이 내용은 OpenRouter와 선택된 추론 공급자를 거친다. 저장 파일이 로컬이라는 것과 모델 입력이 외부로 전송되지 않는다는 것은 다르다. 계정/키 사용 한도와 공급자의 데이터 정책을 확인해야 한다. [맥락 구성](../agent/src/brain.ts), [inline 선택](../agent/src/ctx-tools.ts), [공식 데이터 수집](https://openrouter.ai/docs/guides/privacy/data-collection), [데이터 정책·ZDR 라우팅](https://openrouter.ai/docs/guides/routing/provider-selection)

## OpenRouter 직접 연결만 할 때의 최소 범위(부분안)

이 부분안은 대화·브리핑용 `openrouter` 뇌 추가에 한정되며, 사용자의 pi 대체 요구 전체를 해결하는 안은 아니다. 키 필드는 `brain.openrouterApiKey`, 공급자별 모델은 기존 `brainModels.openrouter` 구조를 따르는 방안을 제안한다. 이는 **아직 사용할 수 있는 설정이 아니다**.

| 영역 | 변경·확인 대상 |
| --- | --- |
| 데몬 설정·키·모델 | `agent/src/config.ts`, `settings.ts`, `models.ts` |
| 추론 요청·기본 모델·오류·상태 | `agent/src/providers.ts`, `brain.ts`, `chat-models.ts`, `connections.ts`, 필요 시 `status.ts` |
| 채팅 요청 허용 목록 | `agent/src/bus.ts`, `desktop/src/chat-pick.js` |
| 연결 UI·설치 단계·모델 탭 | `desktop/src/ai-onboard.js`, `setup-plan.js`, `desktop/renderer/models-view.js`; 기존 설치 화면의 데이터 기반 렌더링 재사용 |
| 키 확인·모델 목록·저장·해제 | `desktop/src/llm-check.js`, `sisa-store.js`, `disconnect.js`; `desktop/main.js`의 IPC 경로 확인 |
| 세부 모델 설정 | `desktop/src/settings.js`의 공급자 허용 목록과 모델 ID 검증; 설정 렌더러 왕복 확인 |
| 보안 회귀 | 키를 응답·로그·도움 보내기에 노출하지 않는지, 리다이렉트 차단·시간 초과·취소 유지 |
| 테스트·가짜 데몬·문서 | 기존 Genspark/provider/settings/chat-model 테스트 패턴, `desktop/scripts/fake-daemon.mjs`, `README.md`, `docs/connect/brain.md`, `docs/contract.md`, 설정 예시 |

기존 DB 구조는 공급자·모델을 문자열로 저장하므로 뇌 추가만을 위해 DB 마이그레이션할 필요는 없어 보인다. 실제 구현에서는 대화별 선택 저장·복원도 회귀 테스트해야 한다. [store](../agent/src/store.ts)

### 이 범위로 가능한 것

- 캐릭터 빠른 대화·패널 채팅·브리핑·대화 제목 등 기존 HTTP 뇌 기능.
- 기존 앱 로직을 통한 할 일·프로젝트 변경.
- ICS 캘린더·IMAP 메일·Slack API 등 직접 수집한 데이터로 답하기.
- 기존 Claude Code/Codex 코드 수정 실행기를 별도로 유지하기.

### 뇌 하나 추가로는 되지 않는 것

- OpenRouter 모델이 직접 MCP·로컬 파일·셸 도구를 실행하는 것.
- 코드 수정 실행기를 OpenRouter로 대체하는 것.
- 현재 Claude Code/Codex 뇌에 한정된 지식그래프 추출·프로필 자동 학습·할 일 자동 진척 판정까지 OpenRouter로 실행하는 것.

위 제한은 현재 프로젝트의 실행 경로·기능 게이트에 따른다. OpenRouter API의 근본적 한계라는 뜻은 아니다. [brain](../agent/src/brain.ts), [feature-brain](../agent/src/feature-brain.ts), [coding](../agent/src/coding.ts)

이미지/PDF 첨부는 선택 모델의 입력 기능과 OpenRouter 처리 방식까지 따로 확인해야 한다. 모든 모델에서 지원한다고 약속하지 않는다. 최초 검증은 텍스트와 실제 채팅/브리핑 JSON 스키마부터 하는 것이 적절하다.

## 실행한 확인

- `npm --prefix agent run typecheck`: 통과.
- AI 연결 관련 데몬 테스트 12개 파일, **149개 테스트 통과**. OS 임시 디렉터리의 별도 `CY_AGENT_HOME`, `TZ=Asia/Seoul` 사용.
- AI 연결 관련 데스크톱 테스트 9개 파일, **84개 테스트 통과**.
- 읽기 전용 assert: 채팅/저장은 `/` 포함 모델 ID 허용, 현재 `openrouter` 선택은 불허, 세부 설정 검증은 `/` 포함 모델 ID 불허.
- OpenRouter 공개 모델 목록 실제 GET: HTTP 200.

이 결과는 **기존 연결 구조의 기준선 확인**이지 아직 없는 OpenRouter 구현의 통합 테스트 통과가 아니다. 전체 테스트 스위트·Electron 화면 조작·Windows 실행·배포 빌드·실제 키 인증·유료 추론·이미지/PDF 호환은 검증하지 않았다. 실제 API 키를 사용하거나 사용자 설정을 변경하지 않았고, 외부 문서 조회에 저장소 소스나 사용자 업무 데이터를 보내지 않았다.
