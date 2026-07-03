'use client';

import { useState } from 'react';

// L03 상담 챗봇 UI — 상품 상세 페이지 [AI 상담] 탭
// 같은 질문을 Claude / OpenAI / A.X 로 바꿔 물어볼 수 있게 모델 선택 제공(모델 비교 실습)

type ModelName = 'claude' | 'openai' | 'ax' | 'gemini';
const MODELS: { key: ModelName; label: string }[] = [
  { key: 'claude', label: 'Claude' },
  { key: 'openai', label: 'OpenAI' },
  { key: 'ax', label: 'A.X (SK)' },
  { key: 'gemini', label: 'Gemini' },
];

type Msg = { role: 'user' | 'bot'; text: string; source?: string; needHuman?: boolean; model?: string };

export function AiChat({ productSlug }: { productSlug: string }) {
  const [model, setModel] = useState<ModelName>('claude');
  const [input, setInput] = useState('');
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [loading, setLoading] = useState(false);

  async function send() {
    const q = input.trim();
    if (!q || loading) return;
    setInput('');
    setMsgs(m => [...m, { role: 'user', text: q }]);
    setLoading(true);
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: q, productSlug, model }),
      });
      const data = await res.json();
      const p = data.parsed ?? {};
      setMsgs(m => [
        ...m,
        {
          role: 'bot',
          text: p.answer ?? data.error ?? '(응답 없음)',
          source: p.source,
          needHuman: p.needHuman,
          model: data.model,
        },
      ]);
    } catch (e: any) {
      setMsgs(m => [...m, { role: 'bot', text: `오류: ${e.message}` }]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl">
      {/* 모델 선택 (모델 비교 실습) */}
      <div className="mb-4 flex items-center gap-2">
        <span className="text-sm text-gray-500">상담 모델:</span>
        {MODELS.map(m => (
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

      {/* 대화창 */}
      <div className="mb-4 h-80 space-y-3 overflow-y-auto rounded-lg border bg-gray-50 p-4">
        {msgs.length === 0 && (
          <p className="text-sm text-gray-400">
            이 상품에 대해 물어보세요. 예: “배송은 언제쯤 되나요?”, “반품 되나요?”
          </p>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={m.role === 'user' ? 'text-right' : 'text-left'}>
            <div
              className={`inline-block max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-2 text-sm ${
                m.role === 'user' ? 'bg-black text-white' : 'bg-white border'
              }`}
            >
              {m.text}
              {m.role === 'bot' && m.source && (
                <div className="mt-1 text-xs text-gray-400">근거: {m.source}{m.model ? ` · ${m.model}` : ''}</div>
              )}
              {m.role === 'bot' && m.needHuman && (
                <button className="mt-2 block rounded bg-amber-500 px-3 py-1 text-xs text-white">
                  상담원 연결하기
                </button>
              )}
            </div>
          </div>
        ))}
        {loading && <p className="text-sm text-gray-400">답변 생성 중…</p>}
      </div>

      {/* 입력 */}
      <div className="flex gap-2">
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && send()}
          placeholder="질문을 입력하세요"
          className="flex-1 rounded-lg border px-4 py-2 text-sm"
        />
        <button onClick={send} disabled={loading} className="rounded-lg bg-black px-5 py-2 text-sm text-white disabled:opacity-50">
          전송
        </button>
      </div>
    </div>
  );
}
