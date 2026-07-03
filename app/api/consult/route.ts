import { NextResponse } from 'next/server';
import { buildEvidenceSet } from '@/lib/evidence-db';
import { callModel, hasKey, parseJsonLoose, type ModelName } from '@/lib/llm';
import { toPublicEvidence } from '@/lib/evidence';
import {
  buildGroundingPrompt,
  parseGrounding,
  deterministicVerify,
  buildAnswerPrompt,
  parseAnswer,
  deterministicAnswer,
  citedEvidence,
  type GroundingVerdict,
  type AnswerResult,
} from '@/lib/consult';

// ── 근거 기반 단계별 상담 API ──────────────────────────────────────
// POST { message, productSlug, model?: 'claude'|'openai'|'ax'|'gemini' }
// ① 구성  : 재고·정책을 원자 근거로 (결정적, 모든 모델 공통)
// ② 검증  : grounding — 각 근거가 답을 뒷받침하는지 (LLM 판정 + 환각 id 제거 게이트)
// ③ 대답  : 검증된 근거만 인용해 답변. 인용 없으면 발행 차단(Evidence-Lock) → 상담원 연결
// LLM 키가 없거나 호출/파싱 실패 시 각 단계는 결정적 폴백으로 동일 인터페이스를 유지한다.

export async function POST(req: Request) {
  const { message, productSlug, model = 'claude' } = await req.json();
  if (!message || !productSlug) {
    return NextResponse.json({ error: 'message, productSlug 필요' }, { status: 400 });
  }

  // ① 구성 (결정적) — 이 근거 세트가 모든 모델의 공통 기반
  const evidence = await buildEvidenceSet(productSlug);
  if (!evidence) {
    return NextResponse.json({ error: '상품 없음' }, { status: 404 });
  }

  const useLlm = hasKey(model as ModelName);

  // ② 검증 = grounding
  let verify: GroundingVerdict;
  if (useLlm) {
    try {
      const { system, user } = buildGroundingPrompt(message, evidence);
      const raw = await callModel(model as ModelName, system, user, 300);
      verify = parseGrounding(parseJsonLoose(raw), evidence) ?? deterministicVerify(evidence, message);
    } catch {
      verify = deterministicVerify(evidence, message); // 호출 실패 → 결정적 폴백
    }
  } else {
    verify = deterministicVerify(evidence, message);
  }

  const grounded = evidence.filter((e) => verify.groundedIds.includes(e.id));

  // ③ 대답 — 검증이 불충분하면 아예 생성하지 않고 발행 차단(상담원 연결)
  let answer: AnswerResult;
  if (!verify.sufficient) {
    answer = {
      answer: '질문에 답할 만한 확인된 근거가 없어 상담원에게 연결해 드리겠습니다.',
      citedIds: [],
      needHuman: true,
      mode: verify.mode,
    };
  } else if (useLlm) {
    try {
      const { system, user } = buildAnswerPrompt(message, grounded);
      const raw = await callModel(model as ModelName, system, user, 500);
      answer = parseAnswer(parseJsonLoose(raw), verify.groundedIds) ?? deterministicAnswer(grounded);
    } catch {
      answer = deterministicAnswer(grounded);
    }
  } else {
    answer = deterministicAnswer(grounded);
  }

  return NextResponse.json({
    model,
    question: message,
    productSlug,
    steps: {
      construct: { evidence: evidence.map(toPublicEvidence) },
      verify: {
        groundedIds: verify.groundedIds,
        sufficient: verify.sufficient,
        reason: verify.reason,
        mode: verify.mode,
      },
      answer: {
        answer: answer.answer,
        citedIds: answer.citedIds,
        needHuman: answer.needHuman,
        mode: answer.mode,
      },
    },
    citedEvidence: citedEvidence(evidence, answer.citedIds),
  });
}
