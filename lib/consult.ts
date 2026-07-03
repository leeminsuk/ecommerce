// 단계별 근거 상담 파이프라인의 '판정' 로직 — 전부 순수 함수(LLM·DB 없음)로 두어
// 유닛 테스트로 게이트를 고정한다. 라우트(app/api/consult)는 이 함수들 + callModel을 엮는다.
//
// 흐름: ① 구성(evidence) → ② 검증=grounding(각 근거가 답을 뒷받침하는지) → ③ 대답(검증 근거만 인용).
// 핵심 계약: 대답은 grounding된 근거만 인용할 수 있고, 인용이 없으면 발행하지 않는다(Evidence-Lock).

import { type Evidence, scoreRelevance, toPublicEvidence } from '@/lib/evidence';

// ② 검증 결과 — 어떤 근거가 grounding됐고, 답하기에 충분한가
export interface GroundingVerdict {
  groundedIds: string[];
  sufficient: boolean;
  reason: string;
  mode: 'llm' | 'deterministic';
}

// ③ 대답 결과 — 인용은 반드시 grounding된 근거 안에서만
export interface AnswerResult {
  answer: string;
  citedIds: string[];
  needHuman: boolean;
  mode: 'llm' | 'deterministic';
}

const evidenceBlock = (evidence: Evidence[]) =>
  evidence.map((e) => `- ${e.id}: ${e.fact}`).join('\n');

// ── ② 검증(grounding) 프롬프트 ──
export function buildGroundingPrompt(question: string, evidence: Evidence[]) {
  const system =
    '너는 근거 검증기다. 아래 [근거] 각각이 [질문]에 답하는 데 실제로 쓰일 수 있는지(grounding) 판정하라. ' +
    '질문과 무관한 근거는 넣지 마라. 근거에 없는 내용을 지어내지 마라. ' +
    '반드시 아래 JSON 하나로만 답하라(설명·마크다운 금지): ' +
    '{"groundedIds":["뒷받침하는 근거 id들"],"sufficient":true 또는 false,"reason":"한국어 한 줄 사유"}';
  const user = `[질문]\n${question}\n\n[근거]\n${evidenceBlock(evidence)}`;
  return { system, user };
}

/** 검증 LLM 응답 파싱 + 게이트: 존재하지 않는(환각) id 제거. 파싱 실패 시 null → 라우트가 폴백 */
export function parseGrounding(
  parsed: unknown,
  evidence: Evidence[],
): GroundingVerdict | null {
  if (!parsed || typeof parsed !== 'object') return null;
  const p = parsed as Record<string, unknown>;
  const valid = new Set(evidence.map((e) => e.id));
  const claimed = Array.isArray(p.groundedIds) ? (p.groundedIds as unknown[]) : [];
  const groundedIds = claimed
    .filter((x): x is string => typeof x === 'string')
    .filter((id) => valid.has(id)); // 환각 id 차단
  const sufficient = Boolean(p.sufficient) && groundedIds.length > 0;
  const reason = typeof p.reason === 'string' && p.reason.trim() ? p.reason.trim() : '검증 완료';
  return { groundedIds, sufficient, reason, mode: 'llm' };
}

/** 결정적 검증 폴백 — 키워드 매칭으로 grounding 판정 (LLM 키 없거나 파싱 실패 시) */
export function deterministicVerify(evidence: Evidence[], question: string): GroundingVerdict {
  const groundedIds = evidence.filter((e) => scoreRelevance(e, question) > 0).map((e) => e.id);
  return {
    groundedIds,
    sufficient: groundedIds.length > 0,
    reason: groundedIds.length > 0 ? '키워드 근거 매칭(결정적)' : '질문과 겹치는 근거 없음(결정적)',
    mode: 'deterministic',
  };
}

// ── ③ 대답 프롬프트 (검증된 근거만 전달) ──
export function buildAnswerPrompt(question: string, grounded: Evidence[]) {
  const system =
    '너는 쇼핑몰 상담원이다. 반드시 아래 [검증된 근거] 안에서만 한국어로 답하라. ' +
    '근거에 없는 내용은 절대 지어내지 말고, 답할 근거가 없으면 needHuman을 true로 하라. ' +
    '사용한 근거의 id를 citedIds에 담아라. ' +
    '반드시 아래 JSON 하나로만 답하라(설명·마크다운 금지): ' +
    '{"answer":"한국어 답변","citedIds":["실제로 사용한 근거 id들"],"needHuman":true 또는 false}';
  const user = `[질문]\n${question}\n\n[검증된 근거]\n${evidenceBlock(grounded)}`;
  return { system, user };
}

/** 대답 LLM 응답 파싱 + Evidence-Lock 발행 게이트: 검증 집합 밖 인용 제거, 인용 0이면 needHuman */
export function parseAnswer(parsed: unknown, groundedIds: string[]): AnswerResult | null {
  if (!parsed || typeof parsed !== 'object') return null;
  const p = parsed as Record<string, unknown>;
  const answer = typeof p.answer === 'string' ? p.answer.trim() : '';
  const allowed = new Set(groundedIds);
  const claimed = Array.isArray(p.citedIds) ? (p.citedIds as unknown[]) : [];
  const citedIds = claimed
    .filter((x): x is string => typeof x === 'string')
    .filter((id) => allowed.has(id)); // Evidence-Lock: 검증 근거만 인용 허용
  // 발행 게이트: 인용 근거가 없거나 답이 비면 사람 연결 (근거 없는 답 발행 금지)
  const needHuman = Boolean(p.needHuman) || citedIds.length === 0 || answer.length === 0;
  return { answer, citedIds, needHuman, mode: 'llm' };
}

/** 결정적 대답 폴백 — 검증된 근거 문장을 그대로 엮어 답 구성 (근거 밖 표현 없음) */
export function deterministicAnswer(grounded: Evidence[]): AnswerResult {
  if (grounded.length === 0) {
    return {
      answer: '확인된 근거가 없어 상담원에게 연결해 드리겠습니다.',
      citedIds: [],
      needHuman: true,
      mode: 'deterministic',
    };
  }
  const answer = grounded.map((e) => e.fact).join(' ');
  return { answer, citedIds: grounded.map((e) => e.id), needHuman: false, mode: 'deterministic' };
}

/** 검증된 근거 id 목록으로 실제 Evidence 객체를 뽑아 (인용 표시용) */
export function citedEvidence(evidence: Evidence[], citedIds: string[]) {
  const byId = new Map(evidence.map((e) => [e.id, e]));
  return citedIds.map((id) => byId.get(id)).filter((e): e is Evidence => Boolean(e)).map(toPublicEvidence);
}
