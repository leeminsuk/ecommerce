import type { Metadata } from 'next';
import prisma from '@/lib/prisma';
import AgentTraceConsole from '@/components/cs/agent-trace-console';

export const metadata: Metadata = {
  title: 'CS 멀티에이전트 트레이스',
  description: '분류→처리 멀티에이전트 오케스트레이션의 판단·결과를 단계별로 추적',
};

export const dynamic = 'force-dynamic';

// 상품 slug 선택지 (근거 상담 대상) — 답변 에이전트가 재고 근거를 붙일 수 있게
export default async function CsAgentsPage() {
  const products = await prisma.product
    .findMany({ where: { status: 'PUBLISHED' }, select: { slug: true, name: true }, orderBy: { createdAt: 'desc' }, take: 20 })
    .catch(() => [] as { slug: string; name: string }[]);

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8">
      <AgentTraceConsole products={products} />
    </div>
  );
}
