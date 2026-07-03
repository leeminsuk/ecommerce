import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { callModel, hasKey, parseJsonLoose, type ModelName } from '@/lib/llm';
import { buildEvidenceSet } from '@/lib/evidence-db';
import { policyEvidence, toPublicEvidence, type Evidence } from '@/lib/evidence';
import {
  buildGroundingPrompt,
  parseGrounding,
  deterministicVerify,
  buildAnswerPrompt,
  parseAnswer,
  deterministicAnswer,
  type GroundingVerdict,
  type AnswerResult,
} from '@/lib/consult';
import {
  buildClassifyPrompt,
  parseClassify,
  deterministicClassify,
  buildRefundPrompt,
  parseRefund,
  deterministicRefund,
  routeCategory,
  routeReason,
  agentMeta,
  type ClassifyVerdict,
  type OrchestrationResult,
  type TraceStep,
} from '@/lib/cs-agents';

// ── CS 멀티에이전트 오케스트레이션 API ─────────────────────────────
// 오케스트레이터가 3개의 에이전트를 지휘하며 각 판단·결과를 trace로 기록한다.
//   ① 분류 에이전트 → (라우팅) → ② 답변 에이전트 or ③ 환불 판정 에이전트
// 답변 에이전트는 근거 검증(grounding) 후 검증된 근거만 인용해 답한다(Evidence-Lock).
// 환불 판정 에이전트는 판정만 하고 실행은 needApproval=true로 사람에게 넘긴다(가드레일).
//
// POST { message, productSlug?, model?: 'claude'|'openai'|'ax'|'gemini' }

const now = () => Date.now();

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const message: string = typeof body.message === 'string' ? body.message.trim() : '';
  const productSlug: string | null = typeof body.productSlug === 'string' && body.productSlug ? body.productSlug : null;
  const model: ModelName = body.model ?? 'ax';
  if (!message) return NextResponse.json({ error: 'message 필요' }, { status: 400 });

  const title = message.slice(0, 40);
  const useLlm = hasKey(model);
  const steps: TraceStep[] = [];
  const t0 = now();

  // ════ ① 분류 에이전트 ════
  const cMeta = agentMeta('classifier');
  const cStart = now();
  let classify: ClassifyVerdict;
  if (useLlm) {
    try {
      const { system, user } = buildClassifyPrompt(title, message);
      const raw = await callModel(model, system, user, 120);
      classify = parseClassify(parseJsonLoose(raw)) ?? deterministicClassify(title, message);
    } catch {
      classify = deterministicClassify(title, message);
    }
  } else {
    classify = deterministicClassify(title, message);
  }
  steps.push({
    role: 'classifier',
    agent: cMeta.name,
    icon: cMeta.icon,
    summary: `${classify.category} · 긴급도 ${classify.urgency}`,
    input: message,
    detail: {
      category: classify.category,
      urgency: classify.urgency,
      confidence: classify.confidence,
      reason: classify.reason,
    },
    mode: classify.mode,
    ms: now() - cStart,
  });

  // ════ 오케스트레이터: 라우팅 결정 ════
  const route = routeCategory(classify.category);
  steps.push({
    role: 'orchestrator',
    agent: '오케스트레이터',
    icon: '🧩',
    summary: route === 'refund' ? '환불 판정 에이전트로 라우팅' : '답변 에이전트로 라우팅',
    input: `분류=${classify.category}`,
    detail: { category: classify.category, route, reason: routeReason(classify.category) },
    mode: 'deterministic',
    ms: 0,
  });

  // ════ 처리 에이전트 분기 ════
  let final: OrchestrationResult['final'];
  if (route === 'refund') {
    final = await runRefundAgent(model, message, useLlm, steps);
  } else {
    final = await runAnswerAgent(model, message, productSlug, useLlm, steps);
  }

  const result: OrchestrationResult = {
    input: { message, productSlug },
    model,
    category: classify.category,
    urgency: classify.urgency,
    route,
    steps,
    final,
    totalMs: now() - t0,
  };
  return NextResponse.json(result);
}

// ── ② 답변 에이전트: 근거 구성 → 검증(grounding) → 검증 근거만 인용해 답변 ──
async function runAnswerAgent(
  model: ModelName,
  message: string,
  productSlug: string | null,
  useLlm: boolean,
  steps: TraceStep[],
): Promise<OrchestrationResult['final']> {
  const meta = agentMeta('answer');
  const start = now();

  // 근거 구성(결정적): 상품이 있으면 재고+가격+정책, 없으면 정책만
  let evidence: Evidence[] | null = productSlug ? await buildEvidenceSet(productSlug) : policyEvidence();
  if (!evidence) evidence = policyEvidence(); // 상품 slug가 잘못돼도 정책 근거로 답변

  // 검증 = grounding
  let verify: GroundingVerdict;
  if (useLlm) {
    try {
      const { system, user } = buildGroundingPrompt(message, evidence);
      const raw = await callModel(model, system, user, 300);
      verify = parseGrounding(parseJsonLoose(raw), evidence) ?? deterministicVerify(evidence, message);
    } catch {
      verify = deterministicVerify(evidence, message);
    }
  } else {
    verify = deterministicVerify(evidence, message);
  }
  const grounded = evidence.filter((e) => verify.groundedIds.includes(e.id));

  // 대답 — 검증 불충분이면 발행 차단(상담원 연결)
  let answer: AnswerResult;
  if (!verify.sufficient) {
    answer = { answer: '질문에 답할 만한 확인된 근거가 없어 상담원에게 연결해 드리겠습니다.', citedIds: [], needHuman: true, mode: verify.mode };
  } else if (useLlm) {
    try {
      const { system, user } = buildAnswerPrompt(message, grounded);
      const raw = await callModel(model, system, user, 500);
      answer = parseAnswer(parseJsonLoose(raw), verify.groundedIds) ?? deterministicAnswer(grounded);
    } catch {
      answer = deterministicAnswer(grounded);
    }
  } else {
    answer = deterministicAnswer(grounded);
  }

  const byId = new Map(evidence.map((e) => [e.id, e]));
  const citedEvidence = answer.citedIds
    .map((id) => byId.get(id))
    .filter((e): e is Evidence => Boolean(e))
    .map((e) => ({ id: e.id, title: e.title, fact: e.fact, source: e.source }));

  steps.push({
    role: 'answer',
    agent: meta.name,
    icon: meta.icon,
    summary: answer.needHuman ? '근거 부족 → 상담원 연결' : `근거 ${answer.citedIds.length}개 인용해 답변`,
    input: message,
    detail: {
      evidence: evidence.map((e) => ({ ...toPublicEvidence(e), grounded: verify.groundedIds.includes(e.id) })),
      grounding: { groundedIds: verify.groundedIds, sufficient: verify.sufficient, reason: verify.reason, mode: verify.mode },
      answer: answer.answer,
      citedIds: answer.citedIds,
      needHuman: answer.needHuman,
    },
    mode: answer.mode,
    ms: now() - start,
  });

  return { kind: 'answer', answer: answer.answer, needHuman: answer.needHuman, citedEvidence };
}

// ── ③ 환불 판정 에이전트: 주문·정책으로 판정, 실행은 사람 승인(가드레일) ──
async function runRefundAgent(
  model: ModelName,
  message: string,
  useLlm: boolean,
  steps: TraceStep[],
): Promise<OrchestrationResult['final']> {
  const meta = agentMeta('refund');
  const start = now();

  // 근거: 가장 최근 주문 1건 (데모)
  const order = await prisma.order.findFirst({ orderBy: { createdAt: 'desc' } }).catch(() => null);
  const orderStatus = order?.status ?? null;
  const orderInfo = order
    ? `주문번호:${order.orderNumber ?? order.id}, 상태:${order.status}, 총액:${order.total}, 결제:${order.paymentMethod ?? '미상'}`
    : '주문 내역 없음';

  let verdict;
  if (useLlm) {
    try {
      const { system, user } = buildRefundPrompt(message, orderInfo);
      const raw = await callModel(model, system, user, 300);
      verdict = parseRefund(parseJsonLoose(raw)) ?? deterministicRefund(orderStatus, message);
    } catch {
      verdict = deterministicRefund(orderStatus, message);
    }
  } else {
    verdict = deterministicRefund(orderStatus, message);
  }

  steps.push({
    role: 'refund',
    agent: meta.name,
    icon: meta.icon,
    summary: `환불 ${verdict.decision} · 사람 승인 필요`,
    input: message,
    detail: {
      orderInfo,
      orderStatus,
      decision: verdict.decision,
      reason: verdict.reason,
      policyBasis: verdict.policyBasis,
      needApproval: true, // ★ 가드레일: AI는 판정만, 실행은 사람
    },
    mode: verdict.mode,
    ms: now() - start,
  });

  return {
    kind: 'refund',
    decision: verdict.decision,
    needApproval: true,
    note: 'AI는 판정만 했습니다. 실제 환불은 담당자 승인 후 진행됩니다.',
  };
}
