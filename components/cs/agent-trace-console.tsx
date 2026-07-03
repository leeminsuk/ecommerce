'use client';

// CS 멀티에이전트 오케스트레이션 트레이스 콘솔.
// 문의를 넣으면 /api/cs-agents가 분류→(답변|환불) 에이전트를 지휘하고,
// 각 에이전트의 판단·결과를 타임라인으로 그린다. "HTML로 내보내기"는 이 실행 하나를
// 자기완결 .html 파일로 저장한다(별도 리포트).

import { useCallback, useState } from 'react';
import type { OrchestrationResult, TraceStep } from '@/lib/cs-agents';

type Product = { slug: string; name: string };

const MODELS = [
  { id: 'claude', label: 'Claude' },
  { id: 'openai', label: 'OpenAI' },
  { id: 'ax', label: 'A.X' },
  { id: 'gemini', label: 'Gemini' },
] as const;

const SAMPLES = [
  '이 상품 지금 재고 남아있나요? 가격이 얼마예요?',
  '주문한 지 3일 됐는데 언제 도착하나요?',
  '받은 제품이 파손된 채로 왔어요. 환불해 주세요.',
  '단순 변심인데 환불 받을 수 있나요?',
  '이 제품 방수가 되나요?',
];

// 카테고리 → hsl 강조색
const CAT_HSL: Record<string, string> = {
  배송: '199 89% 60%',
  상품: '152 60% 52%',
  환불: '38 92% 58%',
  기타: '220 9% 62%',
};
const catColor = (c?: string) => `hsl(${CAT_HSL[c ?? '기타'] ?? CAT_HSL['기타']})`;

export default function AgentTraceConsole({ products }: { products: Product[] }) {
  const [message, setMessage] = useState('');
  const [slug, setSlug] = useState<string>(products[0]?.slug ?? '');
  const [model, setModel] = useState<string>('ax');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<OrchestrationResult | null>(null);

  const run = useCallback(async () => {
    if (!message.trim() || loading) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch('/api/cs-agents', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: message.trim(), productSlug: slug || undefined, model }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? '실행 실패');
      setResult(data as OrchestrationResult);
    } catch (e) {
      setError(e instanceof Error ? e.message : '알 수 없는 오류');
    } finally {
      setLoading(false);
    }
  }, [message, slug, model, loading]);

  const exportHtml = useCallback(() => {
    if (!result) return;
    const html = traceToHtml(result);
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cs-trace-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.html`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }, [result]);

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-950 text-slate-100 shadow-xl">
      {/* 헤더 */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 bg-slate-900/60 px-6 py-4">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">CS 멀티에이전트 · 트레이스 콘솔</h1>
          <p className="mt-0.5 text-xs text-slate-400">
            분류 → (답변 · 근거검증 | 환불 판정) 오케스트레이션. 각 에이전트의 판단과 결과를 단계별로 추적합니다.
          </p>
        </div>
        <span className="rounded-full border border-slate-700 px-2.5 py-1 font-mono text-[11px] text-slate-400">
          3-agent orchestration
        </span>
      </div>

      {/* 파이프라인 지도 */}
      <PipelineMap route={result?.route} category={result?.category} />

      {/* 입력 */}
      <div className="space-y-3 border-b border-slate-800 px-6 py-5">
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') run();
          }}
          rows={3}
          placeholder="고객 문의를 입력하세요 (⌘/Ctrl+Enter 실행)"
          className="w-full resize-none rounded-lg border border-slate-700 bg-slate-900 px-3.5 py-2.5 text-sm text-slate-100 placeholder:text-slate-500 focus:border-slate-500 focus:outline-none"
        />
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-slate-200 focus:outline-none"
          >
            <option value="">상품 미지정 (정책 근거만)</option>
            {products.map((p) => (
              <option key={p.slug} value={p.slug}>
                {p.name}
              </option>
            ))}
          </select>
          <select
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-slate-200 focus:outline-none"
          >
            {MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
          <button
            onClick={run}
            disabled={loading || !message.trim()}
            className="rounded-lg bg-sky-500 px-4 py-2 text-xs font-semibold text-white transition hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {loading ? '실행 중…' : '오케스트레이션 실행'}
          </button>
          {result && (
            <button
              onClick={exportHtml}
              className="rounded-lg border border-slate-600 px-4 py-2 text-xs font-semibold text-slate-200 transition hover:bg-slate-800"
            >
              ⬇ HTML로 내보내기
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {SAMPLES.map((s) => (
            <button
              key={s}
              onClick={() => setMessage(s)}
              className="rounded-full border border-slate-700 px-2.5 py-1 text-[11px] text-slate-400 transition hover:border-slate-500 hover:text-slate-200"
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* 결과 */}
      <div className="px-6 py-5">
        {error && (
          <div className="rounded-lg border border-red-900 bg-red-950/50 px-4 py-3 text-sm text-red-300">
            오류: {error}
          </div>
        )}
        {!error && !result && !loading && (
          <p className="py-8 text-center text-sm text-slate-500">
            문의를 입력하고 실행하면 에이전트들의 판단 흐름이 여기에 나타납니다.
          </p>
        )}
        {loading && <p className="py-8 text-center text-sm text-slate-400">에이전트 실행 중…</p>}
        {result && <Timeline result={result} />}
      </div>
    </section>
  );
}

// ── 상단 파이프라인 지도 (아키텍처) ──
function PipelineMap({ route, category }: { route?: 'answer' | 'refund'; category?: string }) {
  const node = (active: boolean, dim: boolean, icon: string, label: string, color: string) => (
    <div
      className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs transition ${
        active ? 'border-transparent text-slate-900' : dim ? 'border-slate-800 text-slate-600' : 'border-slate-700 text-slate-200'
      }`}
      style={active ? { background: color } : undefined}
    >
      <span>{icon}</span>
      <span className="font-medium">{label}</span>
    </div>
  );
  const arrow = <span className="text-slate-600">→</span>;
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-slate-800 bg-slate-950 px-6 py-3">
      {node(Boolean(category), false, '🧭', '분류', catColor(category))}
      {arrow}
      <span className="text-slate-600">⟨ 라우팅 ⟩</span>
      {arrow}
      <div className="flex items-center gap-2">
        {node(route === 'answer', route === 'refund', '💬', '답변(근거검증)', 'hsl(152 60% 52%)')}
        {node(route === 'refund', route === 'answer', '⚖️', '환불 판정(사람 승인)', 'hsl(38 92% 58%)')}
      </div>
    </div>
  );
}

// ── 타임라인 ──
function Timeline({ result }: { result: OrchestrationResult }) {
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
        <Meta k="모델" v={result.model} />
        <Meta k="분류" v={result.category} color={catColor(result.category)} />
        <Meta k="긴급도" v={result.urgency} />
        <Meta k="경로" v={result.route === 'refund' ? '환불 판정' : '답변'} />
        <Meta k="총 소요" v={`${result.totalMs}ms`} mono />
      </div>

      <ol className="relative ml-3 border-l border-slate-800">
        {result.steps.map((step, i) => (
          <li key={i} className="relative mb-5 ml-6">
            <span className="absolute -left-[38px] flex h-7 w-7 items-center justify-center rounded-full border border-slate-700 bg-slate-900 text-sm">
              {step.icon}
            </span>
            <StepCard step={step} />
          </li>
        ))}
      </ol>

      <FinalCard result={result} />
    </div>
  );
}

function Meta({ k, v, color, mono }: { k: string; v: string; color?: string; mono?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-slate-800 bg-slate-900/60 px-2 py-1">
      <span className="text-slate-500">{k}</span>
      <span className={`font-medium text-slate-200 ${mono ? 'font-mono' : ''}`} style={color ? { color } : undefined}>
        {v}
      </span>
    </span>
  );
}

function ModeBadge({ mode }: { mode: string }) {
  const isLlm = mode === 'llm';
  return (
    <span
      className={`rounded px-1.5 py-0.5 font-mono text-[10px] ${
        isLlm ? 'bg-sky-950 text-sky-300' : 'bg-slate-800 text-slate-400'
      }`}
    >
      {isLlm ? 'LLM' : '결정적'}
    </span>
  );
}

function StepCard({ step }: { step: TraceStep }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-slate-100">{step.agent}</span>
          <ModeBadge mode={step.mode} />
        </div>
        <span className="font-mono text-[11px] text-slate-500">{step.ms}ms</span>
      </div>
      <p className="mt-1 text-xs text-slate-400">{step.summary}</p>
      <div className="mt-3">
        <StepDetail step={step} />
      </div>
    </div>
  );
}

function StepDetail({ step }: { step: TraceStep }) {
  const d = step.detail;
  if (step.role === 'classifier') {
    const conf = Number(d.confidence ?? 0);
    return (
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Chip label={String(d.category)} color={catColor(String(d.category))} />
          <span className="rounded-md border border-slate-700 px-2 py-0.5 text-[11px] text-slate-300">
            긴급도 {String(d.urgency)}
          </span>
          <span className="font-mono text-[11px] text-slate-500">확신 {Math.round(conf * 100)}%</span>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
          <div className="h-full rounded-full bg-sky-500" style={{ width: `${Math.round(conf * 100)}%` }} />
        </div>
        <p className="text-xs text-slate-400">판단: {String(d.reason)}</p>
      </div>
    );
  }
  if (step.role === 'orchestrator') {
    return <p className="text-xs text-slate-400">{String(d.reason)}</p>;
  }
  if (step.role === 'answer') {
    const evidence = (d.evidence as EvItem[]) ?? [];
    const grounding = d.grounding as { sufficient?: boolean; reason?: string } | undefined;
    const citedIds = (d.citedIds as string[]) ?? [];
    const needHuman = Boolean(d.needHuman);
    return (
      <div className="space-y-3">
        <div>
          <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-slate-500">
            근거 검증 (grounding){grounding ? ` · ${grounding.sufficient ? '충분' : '불충분'}` : ''}
          </p>
          <ul className="space-y-1">
            {evidence.map((e) => {
              const cited = citedIds.includes(e.id);
              return (
                <li
                  key={e.id}
                  className={`flex gap-2 rounded-md border px-2.5 py-1.5 text-[11px] ${
                    e.grounded ? 'border-emerald-900/60 bg-emerald-950/30' : 'border-slate-800 bg-slate-900/30 opacity-60'
                  }`}
                >
                  <span className={e.grounded ? 'text-emerald-400' : 'text-slate-600'}>{e.grounded ? '✓' : '·'}</span>
                  <span className="font-mono text-slate-500">{e.id}</span>
                  <span className="flex-1 text-slate-300">{e.fact}</span>
                  {cited && <span className="text-amber-400">인용</span>}
                </li>
              );
            })}
          </ul>
          {grounding?.reason && <p className="mt-1 text-[11px] text-slate-500">사유: {grounding.reason}</p>}
        </div>
        {needHuman ? (
          <div className="rounded-md border border-amber-900/60 bg-amber-950/30 px-3 py-2 text-xs text-amber-300">
            근거 부족 — 답변을 발행하지 않고 상담원에게 연결합니다 (Evidence-Lock).
          </div>
        ) : (
          <div className="rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100">
            {String(d.answer)}
          </div>
        )}
      </div>
    );
  }
  if (step.role === 'refund') {
    const decision = String(d.decision);
    const dc = decision === '가능' ? 'hsl(152 60% 52%)' : decision === '불가' ? 'hsl(0 72% 60%)' : 'hsl(38 92% 58%)';
    return (
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Chip label={`환불 ${decision}`} color={dc} />
          <span className="rounded-md border border-slate-700 px-2 py-0.5 font-mono text-[11px] text-slate-400">
            주문상태 {String(d.orderStatus ?? '없음')}
          </span>
        </div>
        <p className="text-xs text-slate-400">판단: {String(d.reason)}</p>
        <p className="text-[11px] text-slate-500">근거 정책: {String(d.policyBasis)}</p>
        <div className="rounded-md border border-amber-900/60 bg-amber-950/30 px-3 py-2 text-xs text-amber-300">
          🔒 가드레일: AI는 판정만 합니다. 실제 환불 실행은 담당자 승인 후 진행됩니다.
        </div>
      </div>
    );
  }
  return null;
}

function FinalCard({ result }: { result: OrchestrationResult }) {
  const f = result.final;
  return (
    <div className="mt-6 rounded-xl border border-slate-700 bg-slate-900 p-4">
      <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-slate-500">최종 결과 (고객 응대)</p>
      {f.kind === 'answer' ? (
        f.needHuman ? (
          <p className="text-sm text-amber-300">상담원에게 연결해 드리겠습니다. (근거 없는 답변은 발행하지 않습니다.)</p>
        ) : (
          <>
            <p className="text-sm text-slate-100">{f.answer}</p>
            {f.citedEvidence && f.citedEvidence.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {f.citedEvidence.map((e) => (
                  <span key={e.id} className="rounded border border-slate-700 px-2 py-0.5 font-mono text-[10px] text-slate-400">
                    {e.id}
                  </span>
                ))}
              </div>
            )}
          </>
        )
      ) : (
        <div>
          <p className="text-sm text-slate-100">
            환불 판정: <span className="font-semibold">{f.decision}</span>
          </p>
          <p className="mt-1 text-xs text-amber-300">{f.note}</p>
        </div>
      )}
    </div>
  );
}

function Chip({ label, color }: { label: string; color: string }) {
  return (
    <span className="rounded-md px-2 py-0.5 text-[11px] font-semibold text-slate-900" style={{ background: color }}>
      {label}
    </span>
  );
}

type EvItem = { id: string; title: string; fact: string; source: string; grounded: boolean };

// ─────────────────────────────────────────────────────────────
// HTML 내보내기 — 이 실행 하나를 자기완결 리포트로
// ─────────────────────────────────────────────────────────────
function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function traceToHtml(r: OrchestrationResult): string {
  const stepHtml = r.steps
    .map((s) => {
      const mode = s.mode === 'llm' ? 'LLM' : '결정적';
      return `
      <section class="step">
        <div class="step-head">
          <span class="ico">${esc(s.icon)}</span>
          <b>${esc(s.agent)}</b>
          <span class="mode ${s.mode}">${mode}</span>
          <span class="ms">${s.ms}ms</span>
        </div>
        <p class="summary">${esc(s.summary)}</p>
        ${detailHtml(s)}
      </section>`;
    })
    .join('');

  const f = r.final;
  const finalHtml =
    f.kind === 'answer'
      ? f.needHuman
        ? `<p class="warn">상담원 연결 — 근거 없는 답변은 발행하지 않습니다.</p>`
        : `<p>${esc(f.answer)}</p>${
            f.citedEvidence?.length
              ? `<div class="chips">${f.citedEvidence.map((e) => `<code>${esc(e.id)}</code>`).join('')}</div>`
              : ''
          }`
      : `<p>환불 판정: <b>${esc(f.decision)}</b></p><p class="warn">${esc(f.note)}</p>`;

  return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>CS 멀티에이전트 트레이스 · ${esc(r.category)}</title>
<style>
:root{color-scheme:dark}
*{box-sizing:border-box}
body{margin:0;background:#0b1120;color:#e2e8f0;font:14px/1.6 -apple-system,BlinkMacSystemFont,'Apple SD Gothic Neo','Segoe UI',sans-serif}
.wrap{max-width:820px;margin:0 auto;padding:28px 20px}
h1{font-size:18px;margin:0 0 4px}
.sub{color:#94a3b8;font-size:12px;margin:0 0 16px}
.meta{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:20px;font-size:11px}
.meta span{border:1px solid #1e293b;background:#0f172a;border-radius:6px;padding:4px 8px}
.meta b{color:#e2e8f0}
.q{border:1px solid #1e293b;background:#0f172a;border-radius:10px;padding:12px 14px;margin-bottom:18px}
.q .k{color:#64748b;font-size:11px;text-transform:uppercase;letter-spacing:.05em;margin:0 0 4px}
.step{border:1px solid #1e293b;background:rgba(15,23,42,.5);border-radius:12px;padding:14px 16px;margin:0 0 12px}
.step-head{display:flex;align-items:center;gap:8px}
.step-head b{font-size:14px}
.ico{font-size:16px}
.mode{font:10px/1 ui-monospace,monospace;padding:3px 5px;border-radius:4px;background:#1e293b;color:#94a3b8}
.mode.llm{background:#082f49;color:#7dd3fc}
.ms{margin-left:auto;font:11px/1 ui-monospace,monospace;color:#64748b}
.summary{color:#94a3b8;font-size:12px;margin:6px 0 10px}
.ev{list-style:none;padding:0;margin:6px 0}
.ev li{display:flex;gap:8px;border:1px solid #1e293b;border-radius:6px;padding:5px 9px;margin:0 0 4px;font-size:11px;color:#cbd5e1}
.ev li.g{border-color:rgba(6,95,70,.6);background:rgba(6,78,59,.25)}
.ev code{color:#64748b}
.cite{color:#fbbf24;margin-left:auto}
.answer{border:1px solid #334155;background:#0f172a;border-radius:8px;padding:10px 12px;margin-top:8px;color:#f1f5f9}
.warn{border:1px solid rgba(120,53,15,.6);background:rgba(69,26,3,.35);border-radius:8px;padding:8px 12px;color:#fcd34d;font-size:12px}
.chip{display:inline-block;border-radius:6px;padding:2px 8px;font-size:11px;font-weight:700;color:#0b1120}
.kv{color:#94a3b8;font-size:12px;margin:4px 0}
.chips{margin-top:8px}
.chips code{border:1px solid #334155;border-radius:4px;padding:2px 6px;font-size:10px;color:#94a3b8;margin-right:4px}
.final{border:1px solid #334155;background:#0f172a;border-radius:12px;padding:16px;margin-top:20px}
.final .k{color:#64748b;font-size:11px;text-transform:uppercase;letter-spacing:.05em;margin:0 0 8px}
footer{color:#475569;font-size:11px;margin-top:24px;text-align:center}
</style></head>
<body><div class="wrap">
<h1>CS 멀티에이전트 오케스트레이션 · 트레이스</h1>
<p class="sub">생성 ${esc(new Date().toLocaleString('ko-KR'))} · 3-agent (분류 → 답변|환불)</p>
<div class="meta">
  <span>모델 <b>${esc(r.model)}</b></span>
  <span>분류 <b style="color:${esc(catColor(r.category))}">${esc(r.category)}</b></span>
  <span>긴급도 <b>${esc(r.urgency)}</b></span>
  <span>경로 <b>${r.route === 'refund' ? '환불 판정' : '답변'}</b></span>
  <span>총 소요 <b>${r.totalMs}ms</b></span>
</div>
<div class="q"><p class="k">고객 문의</p>${esc(r.input.message)}${
    r.input.productSlug ? `<div class="kv">대상 상품: <code>${esc(r.input.productSlug)}</code></div>` : ''
  }</div>
${stepHtml}
<div class="final"><p class="k">최종 결과 (고객 응대)</p>${finalHtml}</div>
<footer>second-team-commerce · CS multi-agent trace</footer>
</div></body></html>`;
}

function detailHtml(s: TraceStep): string {
  const d = s.detail;
  if (s.role === 'classifier') {
    const conf = Math.round(Number(d.confidence ?? 0) * 100);
    return `<p class="kv"><span class="chip" style="background:${esc(catColor(String(d.category)))}">${esc(d.category)}</span>
      &nbsp;긴급도 ${esc(d.urgency)} · 확신 ${conf}%</p><p class="kv">판단: ${esc(d.reason)}</p>`;
  }
  if (s.role === 'orchestrator') {
    return `<p class="kv">${esc(d.reason)}</p>`;
  }
  if (s.role === 'answer') {
    const evidence = (d.evidence as EvItem[]) ?? [];
    const citedIds = (d.citedIds as string[]) ?? [];
    const grounding = d.grounding as { sufficient?: boolean; reason?: string } | undefined;
    const evs = evidence
      .map(
        (e) =>
          `<li class="${e.grounded ? 'g' : ''}"><span>${e.grounded ? '✓' : '·'}</span><code>${esc(e.id)}</code><span>${esc(
            e.fact,
          )}</span>${citedIds.includes(e.id) ? '<span class="cite">인용</span>' : ''}</li>`,
      )
      .join('');
    const body = d.needHuman
      ? `<p class="warn">근거 부족 — 상담원 연결 (Evidence-Lock)</p>`
      : `<div class="answer">${esc(d.answer)}</div>`;
    return `<p class="kv">근거 검증 (grounding)${grounding ? ` · ${grounding.sufficient ? '충분' : '불충분'}` : ''}</p>
      <ul class="ev">${evs}</ul>${grounding?.reason ? `<p class="kv">사유: ${esc(grounding.reason)}</p>` : ''}${body}`;
  }
  if (s.role === 'refund') {
    const dec = String(d.decision);
    const col = dec === '가능' ? 'hsl(152 60% 52%)' : dec === '불가' ? 'hsl(0 72% 60%)' : 'hsl(38 92% 58%)';
    return `<p class="kv"><span class="chip" style="background:${col}">환불 ${esc(dec)}</span>
      &nbsp;주문상태 ${esc(d.orderStatus ?? '없음')}</p>
      <p class="kv">판단: ${esc(d.reason)}</p><p class="kv">근거 정책: ${esc(d.policyBasis)}</p>
      <p class="warn">🔒 가드레일: AI는 판정만 합니다. 실제 환불은 담당자 승인 후 진행됩니다.</p>`;
  }
  return '';
}
