// LLM 프로바이더 공유 어댑터 — claude / openai / ax(SK A.X) / gemini.
//
// 모델 무관 일관성: 파이프라인은 이 callModel 하나만 쓰고, 모델 교체는 여기 어댑터만
// 바뀐다. OpenAI 호환(openai·ax)은 base_url·key·model만 다르고, claude·gemini는 전용 스키마.

export type ModelName = 'claude' | 'openai' | 'ax' | 'gemini';

export const MODEL_NAMES: ModelName[] = ['claude', 'openai', 'ax', 'gemini'];

// Gemini 모델명 — GEMINI_MODEL 로 교체 가능 (기본: 빠르고 저렴한 flash)
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

/** 해당 모델의 API 키가 설정돼 있는가 — 없으면 결정적 폴백 경로로 */
export function hasKey(model: ModelName): boolean {
  const env: Record<ModelName, string | undefined> = {
    claude: process.env.ANTHROPIC_API_KEY,
    openai: process.env.OPENAI_API_KEY,
    ax: process.env.AX_API_KEY,
    gemini: process.env.GEMINI_API_KEY,
  };
  return Boolean(env[model]);
}

export async function callModel(
  model: ModelName,
  system: string,
  user: string,
  maxTokens = 500,
): Promise<string> {
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
    // Gemini는 OpenAI 호환이 아님 — x-goog-api-key 헤더, generateContent 스키마.
    // 2.5-flash는 thinking 모델이라 thinkingBudget:0으로 꺼야 짧은 답이 안 잘린다.
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
      {
        method: 'POST',
        headers: { 'x-goog-api-key': process.env.GEMINI_API_KEY!, 'content-type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: 'user', parts: [{ text: user }] }],
          generationConfig: { maxOutputTokens: maxTokens, thinkingConfig: { thinkingBudget: 0 } },
        }),
      },
    );
    const d = await r.json();
    if (!r.ok) throw new Error(d?.error?.message ?? 'gemini error');
    return d.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join('') ?? '';
  }

  // OpenAI 호환 (openai / ax 는 base_url·key·model만 다름)
  const compat = {
    openai: { url: 'https://api.openai.com/v1/chat/completions', key: process.env.OPENAI_API_KEY!, model: 'gpt-4o-mini' },
    ax: { url: 'https://awf-gw.adot.ai/v1/chat/completions', key: process.env.AX_API_KEY!, model: 'A.X-K1' },
  };
  const cfg = compat[model as 'openai' | 'ax'];
  if (!cfg) throw new Error(`지원하지 않는 모델: ${model}`);
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
  if (!r.ok) throw new Error(d?.error?.message ?? d?.detail ?? 'openai-compatible error');
  return d.choices?.[0]?.message?.content ?? '';
}

/** JSON 방어 파싱 — 모델이 ```json 펜스나 잡설을 붙여도 객체만 추출 (특히 A.X) */
export function parseJsonLoose<T = any>(text: string): T | null {
  let s = (text || '').trim();
  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  if (fenced) s = fenced.trim();
  const braced = s.match(/\{[\s\S]*\}/)?.[0];
  if (braced) s = braced;
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}
