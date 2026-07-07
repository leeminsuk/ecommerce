'use client';

import { useState } from 'react';

// L06 시연용 CS 데스크 — 문의/요청을 골라 "AI로 처리"를 누르면
// 분류 → 답변 or 환불판정 흐름(trace)이 화면에 뜬다.

type Preset = { label: string; message: string; productSlug?: string };
const PRESETS: Preset[] = [
  { label: '📦 배송 문의', message: '아이폰 언제 배송되나요? 급해요', productSlug: 'iphone-15-pro' },
  { label: '💬 상품 문의', message: '이 헤드폰 노이즈캔슬링 잘 되나요?', productSlug: 'wireless-headphones' },
  { label: '💸 환불 요청', message: '주문한 제품 환불하고 싶어요. 단순 변심입니다.' },
];
const MODELS = [
  { key: 'ax', label: 'A.X (SK)' },
  { key: 'claude', label: 'Claude' },
  { key: 'openai', label: 'OpenAI' },
];

export function CsDesk() {
  const [model, setModel] = useState('ax');
  const [message, setMessage] = useState(PRESETS[0]?.message ?? '');
  const [slug, setSlug] = useState<string | undefined>(PRESETS[0]?.productSlug);
  const [loading, setLoading] = useState(false);
  const [res, setRes] = useState<any>(null);

  async function run() {
    setLoading(true);
    setRes(null);
    try {
      const r = await fetch('/api/cs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message, productSlug: slug, model }),
      });
      setRes(await r.json());
    } catch (e: any) {
      setRes({ error: e.message });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {/* 프리셋 */}
      <div className="flex flex-wrap gap-2">
        {PRESETS.map(p => (
          <button
            key={p.label}
            onClick={() => { setMessage(p.message); setSlug(p.productSlug); setRes(null); }}
            className={`rounded-lg border px-4 py-2 text-sm ${
              message === p.message ? 'border-black bg-black text-white' : 'border-gray-300 text-gray-700'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* 입력 + 모델 */}
      <div className="rounded-xl border bg-white p-4">
        <textarea
          value={message}
          onChange={e => setMessage(e.target.value)}
          rows={2}
          className="w-full resize-none rounded-lg border px-3 py-2 text-sm"
        />
        <div className="mt-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-500">모델:</span>
            {MODELS.map(m => (
              <button
                key={m.key}
                onClick={() => setModel(m.key)}
                className={`rounded-full border px-3 py-1 text-xs ${
                  model === m.key ? 'border-black bg-black text-white' : 'border-gray-300 text-gray-600'
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
          <button
            onClick={run}
            disabled={loading}
            className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {loading ? '처리 중…' : 'AI로 처리 ▶'}
          </button>
        </div>
      </div>

      {/* 결과: 에이전트 흐름 */}
      {res && (
        <div className="space-y-4">
          {/* 분류 배지 */}
          {res.category && (
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-500">① 분류 에이전트 →</span>
              <span className="rounded-full bg-indigo-100 px-3 py-1 text-sm font-bold text-indigo-700">
                {res.category}
              </span>
              <span className="text-xs text-gray-400">({res.model})</span>
            </div>
          )}

          {/* trace 흐름 */}
          {res.trace?.map((t: any, i: number) => (
            <div key={i} className="rounded-lg border-l-4 border-indigo-300 bg-gray-50 p-3">
              <div className="text-xs font-bold text-indigo-600">{t.agent} 에이전트</div>
              <div className="mt-1 whitespace-pre-wrap text-sm text-gray-700">
                {t.decided ? `분류 결과: ${t.decided}` : t.out}
              </div>
            </div>
          ))}

          {/* 최종 결과 */}
          {res.result?.type === '답변' && (
            <div className="rounded-xl border bg-white p-4">
              <div className="text-xs font-bold text-teal-600">② 답변 에이전트 (근거 기반)</div>
              <p className="mt-2 whitespace-pre-wrap text-sm">{res.result.answer}</p>
            </div>
          )}

          {res.result?.type === '환불판정' && (
            <div className="rounded-xl border-2 border-amber-300 bg-amber-50 p-4">
              <div className="text-xs font-bold text-amber-700">③ 환불판정 에이전트</div>
              <p className="mt-2 whitespace-pre-wrap text-sm">{res.result.judgement}</p>
              {res.result.needApproval && (
                <div className="mt-3 flex items-center gap-3 rounded-lg bg-white p-3">
                  <span className="rounded-full bg-red-100 px-3 py-1 text-xs font-bold text-red-700">
                    🔒 사람 승인 필요
                  </span>
                  <span className="text-xs text-gray-500">{res.result.note}</span>
                  <button className="ml-auto rounded bg-red-600 px-3 py-1 text-xs text-white">
                    담당자 승인
                  </button>
                </div>
              )}
            </div>
          )}

          {res.error && <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">오류: {res.error}</div>}
        </div>
      )}
    </div>
  );
}
