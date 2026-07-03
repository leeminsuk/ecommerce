import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

// ── L06 CS 멀티에이전트 ────────────────────────────────────────
// 문의 하나가 들어오면: ① 분류 에이전트 → ② (답변형)답변 에이전트 or (환불형)환불판정 에이전트
// 오케스트레이터가 흐름을 잇는다. 환불 승인은 가드레일 = 사람 최종 승인.
//
// POST { inquiryId?, message?, productSlug?, model? }
//   - inquiryId 주면 그 문의를, 아니면 message로 즉석 처리

type ModelName = 'claude' | 'openai' | 'ax' | 'gemini';

// Gemini 모델명 — GEMINI_MODEL 로 교체 가능 (기본: 빠르고 저렴한 flash)
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

export async function POST(req: Request) {
  const body = await req.json();
  const model: ModelName = body.model ?? 'ax'; // 분류·답변은 A.X 강점 → 기본 A.X

  // 입력 문의 확보
  let inquiry: { title: string; content: string; productSlug?: string };
  if (body.inquiryId) {
    const q = await prisma.inquiry.findUnique({
      where: { id: body.inquiryId },
      include: { product: true },
    });
    if (!q) return NextResponse.json({ error: '문의 없음' }, { status: 404 });
    inquiry = { title: q.title, content: q.content, productSlug: q.product?.slug };
  } else if (body.message) {
    inquiry = { title: body.message.slice(0, 30), content: body.message, productSlug: body.productSlug };
  } else {
    return NextResponse.json({ error: 'inquiryId 또는 message 필요' }, { status: 400 });
  }

  const trace: any[] = [];

  // ── ① 분류 에이전트: 문의를 [배송/상품/환불/기타]로 ──
  const category = await classify(model, inquiry, trace);

  // ── ② 오케스트레이션: 카테고리에 따라 다른 에이전트로 ──
  let result: any;
  if (category === '환불') {
    // 환불형 → 환불 판정 에이전트 (가드레일: 사람 승인)
    result = await refundJudge(model, inquiry, body, trace);
  } else {
    // 그 외 → 답변 에이전트 (근거 기반)
    result = await answerAgent(model, inquiry, category, trace);
  }

  return NextResponse.json({ category, result, trace, model });
}

// ── 분류 에이전트 ──
async function classify(model: ModelName, inquiry: any, trace: any[]): Promise<string> {
  const sys =
    '너는 CS 문의 분류기다. 아래 문의를 [배송, 상품, 환불, 기타] 중 정확히 하나로만 답하라. 다른 말 금지.';
  const out = await callModel(model, sys, `제목:${inquiry.title}\n내용:${inquiry.content}`, 20);
  const cat = ['배송', '상품', '환불', '기타'].find(c => out.includes(c)) ?? '기타';
  trace.push({ agent: '분류', out: out.trim(), decided: cat });
  return cat;
}

// ── 답변 에이전트 (근거 기반) ──
async function answerAgent(model: ModelName, inquiry: any, category: string, trace: any[]) {
  // 근거: 상품 있으면 상품/리뷰/문의답변
  let context = '(일반 문의)';
  if (inquiry.productSlug) {
    const p = await prisma.product.findUnique({
      where: { slug: inquiry.productSlug },
      include: { reviews: { take: 3 }, inquiries: { where: { answer: { not: null } }, take: 3 } },
    });
    if (p) {
      context =
        `상품:${p.name} (${p.price}원)\n설명:${p.description ?? ''}\n` +
        p.reviews.map((r: any) => `후기(${r.rating}): ${r.content}`).join('\n') + '\n' +
        p.inquiries.map((q: any) => `Q:${q.title} A:${q.answer}`).join('\n');
    }
  }
  const sys =
    `너는 쇼핑몰 상담원이다. 분류=${category}. 아래 근거 안에서만 한국어로 친절히 답하라. 근거 밖이면 "상담원 연결"을 안내하라.`;
  const answer = await callModel(model, sys, `[근거]\n${context}\n\n[문의]\n${inquiry.content}`, 400);
  trace.push({ agent: '답변', out: answer.trim() });
  return { type: '답변', answer: answer.trim() };
}

// ── 환불 판정 에이전트 (가드레일: 사람 승인) ──
async function refundJudge(model: ModelName, inquiry: any, body: any, trace: any[]) {
  // 실제 주문 상태를 근거로 (데모: 가장 최근 주문 1건)
  const order = await prisma.order.findFirst({ orderBy: { createdAt: 'desc' } });
  const orderInfo = order
    ? `주문상태:${order.status}, 총액:${order.total}, 결제:${order.paymentMethod}, 결제일:${order.paidAt}`
    : '주문 없음';

  const sys =
    '너는 환불 정책 보조원이다. 아래 주문 상태와 정책을 보고 환불 가능 여부를 판단해 이유를 설명하라. ' +
    '정책: 배송완료(DELIVERED) 후 7일 이내 단순변심 환불 가능, 상품하자는 항상 가능. ' +
    '너는 "판단 근거만" 제시하고, 실제 환불 실행은 절대 하지 마라(사람이 승인).';
  const judged = await callModel(model, sys, `[주문]\n${orderInfo}\n\n[환불요청]\n${inquiry.content}`, 300);
  trace.push({ agent: '환불판정', out: judged.trim(), orderStatus: order?.status });

  // ★ 가드레일: AI는 판정만, 실행은 needApproval=true 로 사람에게 넘김
  return {
    type: '환불판정',
    judgement: judged.trim(),
    needApproval: true, // 사람 최종 승인 필요 — AI가 자동 환불 못 함
    note: 'AI는 판단만 했습니다. 실제 환불은 담당자 승인 후 진행됩니다.',
  };
}

// ── 모델 호출 (L03과 동일 패턴) ──
async function callModel(model: ModelName, system: string, user: string, maxTokens = 300): Promise<string> {
  if (model === 'claude') {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY!,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: maxTokens,
        system,
        messages: [{ role: 'user', content: user }],
      }),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d?.error?.message ?? 'anthropic error');
    return d.content?.[0]?.text ?? '';
  }
  if (model === 'gemini') {
    // Gemini 전용 엔드포인트 — x-goog-api-key 헤더, generateContent 스키마
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
      {
        method: 'POST',
        headers: { 'x-goog-api-key': process.env.GEMINI_API_KEY!, 'content-type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: 'user', parts: [{ text: user }] }],
          // 2.5-flash는 thinking 모델 — thinking을 끄지 않으면 내부 추론이 토큰을 먹어
          // 분류(20토큰) 같은 짧은 답이 빈 문자열이 된다(finishReason=MAX_TOKENS).
          generationConfig: { maxOutputTokens: maxTokens, thinkingConfig: { thinkingBudget: 0 } },
        }),
      },
    );
    const d = await r.json();
    if (!r.ok) throw new Error(d?.error?.message ?? 'gemini error');
    return d.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join('') ?? '';
  }
  const cfg = {
    openai: { url: 'https://api.openai.com/v1/chat/completions', key: process.env.OPENAI_API_KEY!, model: 'gpt-4o-mini' },
    ax: { url: 'https://awf-gw.adot.ai/v1/chat/completions', key: process.env.AX_API_KEY!, model: 'A.X-K1' },
  }[model];
  const r = await fetch(cfg.url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${cfg.key}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: cfg.model,
      max_tokens: maxTokens,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d?.error?.message ?? d?.detail ?? 'error');
  return d.choices?.[0]?.message?.content ?? '';
}
