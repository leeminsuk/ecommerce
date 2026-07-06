import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { STORE_POLICY } from '@/lib/policy';

// ── L03 상담 챗봇 API (RAG + 모델 비교) ────────────────────────────
// POST { message, productSlug, model?: 'claude' | 'openai' | 'ax' }
// 흐름: ① 근거 검색(Retrieval) → ② 근거+질문으로 답 생성(Generation, JSON)

type ModelName = 'claude' | 'openai' | 'ax';

export async function POST(req: Request) {
  const { message, productSlug, model = 'claude' } = await req.json();
  if (!message || !productSlug) {
    return NextResponse.json({ error: 'message, productSlug 필요' }, { status: 400 });
  }

  // ── ① Retrieval: 이 상품의 근거(상품설명·리뷰·문의답변) + 정책 모으기 ──
  const product = await prisma.product.findUnique({
    where: { slug: productSlug },
    include: {
      reviews: { take: 5, orderBy: { createdAt: 'desc' } },
      inquiries: { where: { answer: { not: null } }, take: 5 },
    },
  });
  if (!product) {
    return NextResponse.json({ error: '상품 없음' }, { status: 404 });
  }

  const context = buildContext(product);

  // ── ② Generation: 근거를 넣어 근거 기반 답변(JSON) ──
  const system =
    '너는 쇼핑몰 상담원이다. 반드시 아래 [근거] 안에서만 답하라. ' +
    '근거에 없는 내용은 지어내지 말고 needHuman을 true로 하고 "상담원에게 연결해드릴게요"라고 답하라. ' +
    '반드시 아래 JSON 형식으로만 답하라(설명·마크다운 금지): ' +
    '{"answer":"한국어 답변","source":"사용한 근거 요약","needHuman":true 또는 false}';
  const user = `[근거]\n${context}\n\n[질문]\n${message}`;

  let raw = '';
  try {
    raw = await callModel(model as ModelName, system, user);
  } catch (e: any) {
    return NextResponse.json({ error: `모델 호출 실패: ${e.message}` }, { status: 502 });
  }

  const parsed = parseJsonLoose(raw);
  return NextResponse.json({ model, parsed, raw });
}

// 근거 묶음 문자열 만들기
function buildContext(product: any): string {
  const parts: string[] = [];
  parts.push(`# 상품: ${product.name} (${product.price?.toLocaleString?.() ?? product.price}원)`);
  if (product.description) parts.push(`설명: ${product.description}`);
  if (product.content) parts.push(`상세: ${product.content}`);
  if (product.reviews?.length) {
    parts.push('# 고객 후기');
    product.reviews.forEach((r: any) =>
      parts.push(`- (별점 ${r.rating}) ${r.title ?? ''} ${r.content ?? ''}`.trim()),
    );
  }
  if (product.inquiries?.length) {
    parts.push('# 자주 묻는 질문(문의·답변)');
    product.inquiries.forEach((q: any) => parts.push(`- Q: ${q.title}\n  A: ${q.answer}`));
  }
  parts.push('# 배송·반품 정책');
  parts.push(STORE_POLICY);
  return parts.join('\n');
}

// ── 모델 호출 (OpenAI 호환은 base_url만 다름) ──
async function callModel(model: ModelName, system: string, user: string): Promise<string> {
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
        max_tokens: 500,
        system,
        messages: [{ role: 'user', content: user }],
      }),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d?.error?.message ?? 'anthropic error');
    return d.content?.[0]?.text ?? '';
  }

  // OpenAI 호환 (openai / ax 는 base_url·key·model만 다름)
  const cfg = {
    openai: {
      url: 'https://api.openai.com/v1/chat/completions',
      key: process.env.OPENAI_API_KEY!,
      model: 'gpt-4o-mini',
    },
    ax: {
      url: 'https://awf-gw.adot.ai/v1/chat/completions',
      key: process.env.AX_API_KEY!,
      model: 'A.X-K1',
    },
  }[model];

  const r = await fetch(cfg.url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${cfg.key}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: cfg.model,
      max_tokens: 500,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d?.error?.message ?? d?.detail ?? 'openai-compatible error');
  return d.choices?.[0]?.message?.content ?? '';
}

// ── JSON 방어 파싱 (```json 펜스가 붙을 수 있음, 특히 A.X) ──
function parseJsonLoose(text: string): any {
  let s = (text || '').trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const fenced = fence?.[1];
  if (fenced) s = fenced.trim();
  const braces = s.match(/\{[\s\S]*\}/);
  if (braces) s = braces[0];
  try {
    return JSON.parse(s);
  } catch {
    return { answer: text, source: '(형식 파싱 실패)', needHuman: true };
  }
}
