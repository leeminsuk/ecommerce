// CS 멀티에이전트 오케스트레이션의 '판정' 로직 — 전부 순수 함수(LLM·DB 없음).
//
// 구성: 오케스트레이터가 3개의 에이전트를 지휘한다.
//   ① 분류 에이전트   : 문의를 [배송/상품/환불/기타] + 긴급도로 분류
//   ② 답변 에이전트   : 배송/상품/기타 → 근거를 검증(grounding)하고 근거 안에서만 답변
//   ③ 환불 판정 에이전트: 환불 → 주문·정책으로 환불 가부 판정 (실행은 사람 승인 = 가드레일)
//
// 라우트(app/api/cs-agents)가 이 순수 함수들 + callModel + DB를 엮는다.
// 프롬프트 파서는 모델이 형식을 어기거나 없는 값을 지어내도 안전하게 정규화한다.

import type { ModelName } from '@/lib/llm';

// ── 카테고리·긴급도 ──
export type CsCategory = '배송' | '상품' | '환불' | '기타';
export type Urgency = '낮음' | '보통' | '높음';
export const CATEGORIES: CsCategory[] = ['배송', '상품', '환불', '기타'];
const URGENCIES: Urgency[] = ['낮음', '보통', '높음'];

// ── 에이전트 역할 & UI 레지스트리 ──
export type AgentRole = 'classifier' | 'orchestrator' | 'answer' | 'refund';

export interface AgentMeta {
  role: AgentRole;
  name: string;
  icon: string;
  desc: string;
  accent: string; // UI 강조색 (hsl)
}

/** trace 뷰가 파이프라인 노드를 그릴 때 쓰는 에이전트 카탈로그 */
export const AGENTS: AgentMeta[] = [
  { role: 'classifier', name: '분류 에이전트', icon: '🧭', desc: '문의를 배송·상품·환불·기타로 분류하고 긴급도를 판단', accent: '199 89% 60%' },
  { role: 'answer', name: '답변 에이전트', icon: '💬', desc: '근거를 검증(grounding)하고 검증된 근거 안에서만 답변', accent: '152 60% 52%' },
  { role: 'refund', name: '환불 판정 에이전트', icon: '⚖️', desc: '주문·정책으로 환불 가부를 판정 (실행은 사람 승인)', accent: '38 92% 58%' },
];

export function agentMeta(role: AgentRole): AgentMeta {
  return AGENTS.find((a) => a.role === role) ?? AGENTS[0]!;
}

// ── 오케스트레이션 라우팅: 환불형만 환불 에이전트, 나머지는 답변 에이전트 ──
export function routeCategory(category: CsCategory): 'answer' | 'refund' {
  return category === '환불' ? 'refund' : 'answer';
}

export function routeReason(category: CsCategory): string {
  return category === '환불'
    ? '환불형 문의 → 환불 판정 에이전트 (정책·주문 대조, 사람 승인 필요)'
    : `${category}형 문의 → 답변 에이전트 (근거 검증 후 근거 안에서만 답변)`;
}

// ════════════════════ ① 분류 에이전트 ════════════════════

export interface ClassifyVerdict {
  category: CsCategory;
  urgency: Urgency;
  confidence: number; // 0~1
  reason: string;
  mode: 'llm' | 'deterministic';
}

export function buildClassifyPrompt(title: string, content: string) {
  const system =
    '너는 쇼핑몰 CS 문의 분류 에이전트다. 아래 문의를 정확히 판단하라. ' +
    'category는 [배송, 상품, 환불, 기타] 중 하나. urgency는 [낮음, 보통, 높음] 중 하나. ' +
    'confidence는 0~1 사이 확신도. reason은 한국어 한 줄 사유. ' +
    '반드시 아래 JSON 하나로만 답하라(설명·마크다운 금지): ' +
    '{"category":"…","urgency":"…","confidence":0.0,"reason":"…"}';
  const user = `[제목]\n${title}\n\n[내용]\n${content}`;
  return { system, user };
}

const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);

function normCategory(v: unknown): CsCategory | null {
  if (typeof v !== 'string') return null;
  return CATEGORIES.find((c) => v.includes(c)) ?? null;
}

function normUrgency(v: unknown): Urgency {
  if (typeof v === 'string') {
    const hit = URGENCIES.find((u) => v.includes(u));
    if (hit) return hit;
  }
  return '보통';
}

/** 분류 LLM 응답 파싱 — category를 못 뽑으면 null(라우트가 결정적 폴백) */
export function parseClassify(parsed: unknown): ClassifyVerdict | null {
  if (!parsed || typeof parsed !== 'object') return null;
  const p = parsed as Record<string, unknown>;
  const category = normCategory(p.category);
  if (!category) return null;
  const rawConf = typeof p.confidence === 'number' ? p.confidence : Number(p.confidence);
  const confidence = Number.isFinite(rawConf) ? clamp01(rawConf) : 0.7;
  const reason = typeof p.reason === 'string' && p.reason.trim() ? p.reason.trim() : '문의 내용 기반 분류';
  return { category, urgency: normUrgency(p.urgency), confidence, reason, mode: 'llm' };
}

// 결정적 분류 키워드 — 환불 신호를 먼저 본다(배송비 환불 등도 환불로).
const KW: Record<Exclude<CsCategory, '기타'>, string[]> = {
  환불: ['환불', '취소', '반품', '교환', '하자', '불량', '파손', '고장', '결제취소', '돈'],
  배송: ['배송', '언제', '도착', '출고', '며칠', '택배', '송장', '운송장', '배송비', '오배송'],
  상품: ['재고', '품절', '가격', '얼마', '할인', '세일', '재입고', '사이즈', '색상', '스펙', '옵션'],
};
const HIGH_URGENCY = ['급', '빨리', '당장', '언제까지', '지금', '화가', '환불해', '취소해', '오늘'];

/** 결정적 분류 폴백 — 키워드 매칭 (LLM 키 없거나 파싱 실패 시) */
export function deterministicClassify(title: string, content: string): ClassifyVerdict {
  const text = `${title} ${content}`;
  let category: CsCategory = '기타';
  for (const c of ['환불', '배송', '상품'] as const) {
    if (KW[c].some((k) => text.includes(k))) {
      category = c;
      break;
    }
  }
  const urgency: Urgency = HIGH_URGENCY.some((k) => text.includes(k)) ? '높음' : '보통';
  return {
    category,
    urgency,
    confidence: category === '기타' ? 0.4 : 0.6,
    reason: category === '기타' ? '분류 키워드 미발견(결정적)' : `'${category}' 키워드 매칭(결정적)`,
    mode: 'deterministic',
  };
}

// ════════════════════ ③ 환불 판정 에이전트 ════════════════════

export type RefundDecision = '가능' | '불가' | '추가확인';
const REFUND_DECISIONS: RefundDecision[] = ['가능', '불가', '추가확인'];

export interface RefundVerdict {
  decision: RefundDecision;
  reason: string;
  policyBasis: string;
  mode: 'llm' | 'deterministic';
}

export function buildRefundPrompt(content: string, orderInfo: string) {
  const system =
    '너는 환불 정책 판정 에이전트다. 아래 [주문]과 [정책]만 근거로 환불 가부를 판정하라. ' +
    '정책: 배송완료(DELIVERED) 후 7일 이내 단순변심 환불 가능, 상품 하자·오배송은 상태 무관 항상 가능. ' +
    '너는 판정만 하고 실제 환불은 절대 실행하지 마라(사람이 최종 승인). ' +
    'decision은 [가능, 불가, 추가확인] 중 하나. ' +
    '반드시 아래 JSON 하나로만 답하라(설명·마크다운 금지): ' +
    '{"decision":"…","reason":"한국어 사유","policyBasis":"적용 정책"}';
  const user = `[주문]\n${orderInfo}\n\n[환불요청]\n${content}`;
  return { system, user };
}

function normDecision(v: unknown): RefundDecision | null {
  if (typeof v !== 'string') return null;
  // '불가능'은 '가능'을 부분문자열로 포함 → 더 구체적인 '불가'/'추가확인'을 먼저 본다
  const order: RefundDecision[] = ['불가', '추가확인', '가능'];
  return order.find((d) => v.includes(d)) ?? null;
}

/** 환불 판정 LLM 응답 파싱 — decision을 못 뽑으면 null */
export function parseRefund(parsed: unknown): RefundVerdict | null {
  if (!parsed || typeof parsed !== 'object') return null;
  const p = parsed as Record<string, unknown>;
  const decision = normDecision(p.decision);
  if (!decision) return null;
  const reason = typeof p.reason === 'string' && p.reason.trim() ? p.reason.trim() : '정책·주문 대조 결과';
  const policyBasis = typeof p.policyBasis === 'string' && p.policyBasis.trim() ? p.policyBasis.trim() : '교환·반품 정책';
  return { decision, reason, policyBasis, mode: 'llm' };
}

/** 결정적 환불 판정 폴백 — 주문 상태·하자 신호로 판정 */
export function deterministicRefund(orderStatus: string | null, content: string): RefundVerdict {
  const defect = ['하자', '불량', '파손', '고장', '오배송'].some((k) => content.includes(k));
  if (defect) {
    return { decision: '가능', reason: '상품 하자·오배송은 배송 상태와 무관하게 환불 가능(결정적).', policyBasis: '하자·오배송 정책', mode: 'deterministic' };
  }
  if (orderStatus === 'DELIVERED') {
    return { decision: '추가확인', reason: '배송완료 상태 — 수령 후 7일 이내인지 확인 필요(결정적).', policyBasis: '단순변심 7일 이내', mode: 'deterministic' };
  }
  if (orderStatus === null) {
    return { decision: '추가확인', reason: '주문 내역을 확인할 수 없어 상담원 확인이 필요합니다(결정적).', policyBasis: '주문 조회 불가', mode: 'deterministic' };
  }
  return { decision: '추가확인', reason: `주문 상태(${orderStatus}) — 배송완료 전이라 진행 상황 확인이 필요합니다(결정적).`, policyBasis: '단순변심 7일 이내', mode: 'deterministic' };
}

// ════════════════════ trace 구조 ════════════════════

/** 한 에이전트의 판단·결과 한 스텝 — trace 뷰의 카드 하나 */
export interface TraceStep {
  role: AgentRole;
  agent: string;
  icon: string;
  /** 한 줄 결론 (칩·헤더에 표시) */
  summary: string;
  /** 이 에이전트가 받은 입력 요약 */
  input: string;
  /** 역할별 구조화 상세 (UI가 role로 분기 렌더) */
  detail: Record<string, unknown>;
  mode: 'llm' | 'deterministic';
  ms: number;
}

export interface PublicEvidenceLite {
  id: string;
  title: string;
  fact: string;
  source: string;
}

export interface OrchestrationResult {
  input: { message: string; productSlug: string | null };
  model: ModelName;
  category: CsCategory;
  urgency: Urgency;
  route: 'answer' | 'refund';
  steps: TraceStep[];
  final: {
    kind: 'answer' | 'refund';
    // 답변 경로
    answer?: string;
    needHuman?: boolean;
    citedEvidence?: PublicEvidenceLite[];
    // 환불 경로
    decision?: RefundDecision;
    needApproval?: boolean;
    note?: string;
  };
  totalMs: number;
}
