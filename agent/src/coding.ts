// 코드 작업 AI(코드 고치기 실행기): Claude Code · Codex · pi. 대화 AI(brain.provider)와 따로 고른다.
//   - 고른 것: config.json coding.provider. 안 골랐으면 Claude Code, 다만 Claude Code 가 없고(로그인 안 됨) Codex 가 준비됐으면 Codex
//   - 모델은 한 곳: Claude Code 면 models.code, Codex 면 brainModels.codex.code, pi 면 brainModels.openrouter.code
//     (설정 창 「세부 모델」의 코드 작업 칸). 비면 그 실행기 기본(pi 는 모델이 꼭 있어야 준비로 본다)
//   - 준비: Claude Code 는 로그인(Connections.claudeLoggedIn — main 이 setClaudeProbe 로 알려 준다, 모르면 null),
//     Codex 는 codex 명령 + 로그인 파일(auth.json; keyring 에만 저장했으면 준비 안 됨),
//     pi 는 pi 명령 + 시사가 관리하는 OpenRouter 키 + 그 키로 쓸 OpenRouter 코딩 모델
import type { CodingProvider, Config } from "./config.ts";
import { modelFits } from "./models.ts";
import { commandOnPath } from "./providers.ts";
import { codexAuthReady } from "./codex-coder.ts";

export type CoderAvail = { claude?: boolean | null; codex?: boolean; pi?: boolean };

let claudeProbe: () => boolean | undefined = () => undefined;
export function setClaudeProbe(fn: () => boolean | undefined) { claudeProbe = fn; }

export const codexCodingReady = (env: NodeJS.ProcessEnv = process.env) => commandOnPath("codex", env) && codexAuthReady(env);
// pi 실행기: pi CLI 가 있으면 된다(키·모델은 codingReady 가 시사 설정에서 본다)
export const piCodingReady = (env: NodeJS.ProcessEnv = process.env) => commandOnPath("pi", env);
export const coderAvail = (env: NodeJS.ProcessEnv = process.env): CoderAvail => ({ claude: claudeProbe() ?? null, codex: codexCodingReady(env), pi: piCodingReady(env) });

export function codingProvider(cfg: Pick<Config, "coding">, avail: CoderAvail = coderAvail()): CodingProvider {
  if (cfg.coding?.provider) return cfg.coding.provider;
  return avail.claude === false && avail.codex ? "codex" : "claude-code"; // pi 는 골라야 쓴다(키·모델을 시사 설정에서 확인해야 한다)
}

// 코드 작업을 맡길 수 있나: true · false · null(Claude Code 로그인 확인 전 — 막지 않는다)
export function codingReady(cfg: Pick<Config, "coding" | "brain"> & { brainModels?: Config["brainModels"] }, avail: CoderAvail = coderAvail()): boolean | null {
  const provider = codingProvider(cfg, avail);
  if (provider === "codex") return !!avail.codex;
  if (provider === "pi") {
    const m = cfg.brainModels?.openrouter?.code;
    return !!avail.pi && !!cfg.brain?.openrouterApiKey && !!m && modelFits("openrouter", m);
  }
  return avail.claude ?? null;
}

// 그 실행기의 코드 작업 모델. undefined = 그 실행기 기본(Codex 설정의 기본 모델 · pi 는 모델이 없으면 시작하지 않는다)
export function codingModel(cfg: Pick<Config, "models" | "brainModels">, provider: CodingProvider): string | undefined {
  if (provider === "codex") {
    const m = cfg.brainModels?.codex?.code;
    return m && modelFits("codex", m) ? m : undefined;
  }
  if (provider === "pi") {
    const m = cfg.brainModels?.openrouter?.code;
    return m && modelFits("openrouter", m) ? m : undefined;
  }
  return cfg.models.code;
}

// 이번 코드 작업의 실행기·모델. picked: 세션 창에서 고른 모델(그 실행기에 맞을 때만)
export function codingChoice(cfg: Pick<Config, "coding" | "models" | "brainModels">, picked?: string, avail?: CoderAvail): { provider: CodingProvider; model?: string } {
  const provider = codingProvider(cfg, avail);
  // 세션 창에서 고른 것: 그 실행기에 맞을 때만(codex·pi 는 "codex"·"pi" 라는 실행기 이름 자체는 모델이 아니다)
  const usable = (m: string) => m !== "codex" && m !== "pi" && modelFits(provider, m);
  const model = picked && usable(picked) ? picked : codingModel(cfg, provider);
  return { provider, ...(model ? { model } : {}) };
}
