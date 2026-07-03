'use client';

import { useState } from 'react';

// 근거 기반 단계별 상담 UI — 상품 상세 [근거 상담] 탭
// 같은 질문을 4개 모델로 돌려 ① 근거 구성 → ② 검증(grounding) → ③ 대답의 체인을 눈으로 비교한다.
// 판정(구성·검증 게이트)은 서버의 결정적 코드가, 표현만 모델이 한다.

type ModelName = 'claude' | 'openai' | 'ax' | 'gemini';
const MODELS: { key: ModelName; label: string }[] = [
  { key: 'claude', label: 'Claude' },
  { key: 'openai', label: 'OpenAI' },
  { key: 'ax', label: 'A.X (SK)' },
  { key: 'gemini', label: 'Gemini' },
];

interface PublicEvidence {
  id: string;
  kind: 'inventory' | 'pricing' | 'policy';
  title: string;
  fact: string;
  source: string;
}
interface ConsultResult {
  model: string;
  question: string;
  steps: {
    construct: { evidence: PublicEvidence[] };
    verify: { groundedIds: string[]; sufficient: boolean; reason: string; mode: 'llm' | 'deterministic' };
    answer: { answer: string; citedIds: string[]; needHuman: boolean; mode: 'llm' | 'deterministic' };
  };
  citedEvidence: PublicEvidence[];
}

const KIND_LABEL: Record<PublicEvidence['kind'], string> = {
  inventory: '재고',
  pricing: '가격',
  policy: '정책',
};
const KIND_COLOR: Record<PublicEvidence['kind'], string> = {
  inventory: 'bg-blue-50 text-blue-700 border-blue-200',
  pricing: 'bg-violet-50 text-violet-700 border-violet-200',
  policy: 'bg-emerald-50 text-emerald-700 border-emerald-200',
};

export function GroundedConsult({ productSlug }: { productSlug: string }) {
  const [model, setModel] = useState<ModelName>('claude');
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ConsultResult | null>(null);

  async function ask() {
    const q = input.trim();
    if (!q || loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/consult', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: q, productSlug, model }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `요청 실패 (${res.status})`);
      setResult(data);
    } catch (e: any) {
      setError(e.message);
      setResult(null);
    } finally {
      setLoading(false);
    }
  }

  const verify = result?.steps.verify;
  const grounded = new Set(verify?.groundedIds ?? []);
  const cited = new Set(result?.steps.answer.citedIds ?? []);

  return (
    <div className="mx-auto max-w-3xl">
      {/* 입력 + 모델 선택 */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="text-sm text-gray-500">상담 모델:</span>
        {MODELS.map((m) => (
          <button
            key={m.key}
            onClick={() => setModel(m.key)}
            className={`rounded-full border px-3 py-1 text-sm ${
              model === m.key ? 'border-black bg-black text-white' : 'border-gray-300 text-gray-600'
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>
      <div className="mb-6 flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && ask()}
          placeholder="예: 재고 남아있나요? 반품 되나요? 할인 얼마나 되나요?"
          className="flex-1 rounded-lg border px-4 py-2 text-sm"
        />
        <button
          onClick={ask}
          disabled={loading}
          className="rounded-lg bg-black px-5 py-2 text-sm text-white disabled:opacity-50"
        >
          {loading ? '분석 중…' : '근거로 답하기'}
        </button>
      </div>

      {error && (
        <p className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">오류: {error}</p>
      )}

      {!result && !error && (
        <p className="text-sm text-gray-400">
          질문을 입력하면 재고·정책 근거를 <b>구성</b>하고, 각 근거가 답을 뒷받침하는지 <b>검증(grounding)</b>한 뒤,
          검증된 근거만 인용해 <b>대답</b>합니다. 근거가 없으면 지어내지 않고 상담원에게 연결합니다.
        </p>
      )}

      {result && (
        <div className="space-y-5">
          {/* ① 구성 */}
          <section className="rounded-xl border p-4">
            <div className="mb-3 flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-black text-xs font-bold text-white">1</span>
              <h4 className="font-semibold">근거 구성 (재고·정책 {result.steps.construct.evidence.length}종)</h4>
              <span className="text-xs text-gray-400">결정적 · 모든 모델 공통</span>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {result.steps.construct.evidence.map((e) => {
                const isGrounded = grounded.has(e.id);
                return (
                  <div
                    key={e.id}
                    className={`rounded-lg border p-2 text-xs ${
                      isGrounded ? 'border-black/40 bg-white' : 'border-gray-200 bg-gray-50 opacity-60'
                    }`}
                  >
                    <div className="mb-1 flex items-center gap-1">
                      <span className={`rounded border px-1.5 py-0.5 text-[10px] ${KIND_COLOR[e.kind]}`}>
                        {KIND_LABEL[e.kind]}
                      </span>
                      <span className="font-mono text-[10px] text-gray-400">{e.id}</span>
                      {isGrounded && <span className="ml-auto text-[10px] font-bold text-green-600">✓ 채택</span>}
                    </div>
                    <p className="text-gray-700">{e.fact}</p>
                    <p className="mt-1 text-[10px] text-gray-400">출처: {e.source}</p>
                  </div>
                );
              })}
            </div>
          </section>

          {/* ② 검증 = grounding */}
          <section className="rounded-xl border p-4">
            <div className="mb-3 flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-black text-xs font-bold text-white">2</span>
              <h4 className="font-semibold">검증 (grounding)</h4>
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] ${
                  verify?.mode === 'llm' ? 'bg-gray-900 text-white' : 'bg-gray-200 text-gray-600'
                }`}
              >
                {verify?.mode === 'llm' ? `${result.model} 판정` : '결정적 폴백'}
              </span>
              <span
                className={`ml-auto rounded-full px-2 py-0.5 text-xs font-semibold ${
                  verify?.sufficient ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'
                }`}
              >
                {verify?.sufficient ? '근거 충분' : '근거 부족'}
              </span>
            </div>
            <p className="mb-2 text-sm text-gray-600">{verify?.reason}</p>
            <div className="flex flex-wrap gap-1.5">
              {(verify?.groundedIds ?? []).length === 0 && (
                <span className="text-xs text-gray-400">뒷받침하는 근거 없음</span>
              )}
              {(verify?.groundedIds ?? []).map((id) => (
                <span key={id} className="rounded-full border border-green-300 bg-green-50 px-2 py-0.5 font-mono text-[10px] text-green-700">
                  {id}
                </span>
              ))}
            </div>
          </section>

          {/* ③ 대답 */}
          <section className="rounded-xl border p-4">
            <div className="mb-3 flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-black text-xs font-bold text-white">3</span>
              <h4 className="font-semibold">대답</h4>
              {result.steps.answer.mode === 'deterministic' && (
                <span className="rounded-full bg-gray-200 px-2 py-0.5 text-[10px] text-gray-600">결정적 폴백</span>
              )}
            </div>
            {result.steps.answer.needHuman ? (
              <div className="rounded-lg bg-amber-50 p-3">
                <p className="text-sm text-amber-800">{result.steps.answer.answer}</p>
                <button className="mt-2 rounded bg-amber-500 px-3 py-1 text-xs text-white">상담원 연결하기</button>
                <p className="mt-2 text-[11px] text-amber-600">
                  근거로 뒷받침되지 않아 답변을 발행하지 않았습니다 (Evidence-Lock).
                </p>
              </div>
            ) : (
              <>
                <p className="whitespace-pre-wrap rounded-lg bg-gray-50 p-3 text-sm text-gray-800">
                  {result.steps.answer.answer}
                </p>
                <div className="mt-3">
                  <p className="mb-1 text-xs font-semibold text-gray-500">인용한 근거</p>
                  <ul className="space-y-1">
                    {result.citedEvidence.map((e) => (
                      <li key={e.id} className="flex items-start gap-2 text-xs text-gray-600">
                        <span className="mt-0.5 font-mono text-[10px] text-gray-400">{e.id}</span>
                        <span>
                          {e.fact} <span className="text-gray-400">— {e.source}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
