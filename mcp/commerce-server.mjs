// 커머스 근거 MCP 서버 — 재고데이터(DB)와 정책데이터를 도구로 노출한다.
// 상담 파이프라인(app/api/consult)이 쓰는 것과 같은 근거를 AI 에이전트(Claude Code/Codex 등)도
// MCP 도구로 끌어다 쓸 수 있게 한다.
//   - get_inventory(slug) : 상품의 재고·가격 사실 (DB:inventory, DB:product)
//   - get_policy(topic?)  : 배송/교환·반품/결제 정책 조항
//   - list_products()     : 근거를 조회할 수 있는 상품 slug 목록
// 정책 조항은 lib/evidence.ts 의 policyEvidence() 와 동일하게 유지한다(단일 사실원).

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const server = new McpServer({ name: 'commerce-server', version: '1.0.0' });

// lib/evidence.ts policyEvidence() 와 동기화된 정책 근거
const POLICY = [
  { id: 'pol:shipping-fee', topic: '배송', title: '배송비', fact: '5만원 이상 구매 시 무료배송이며, 미만이면 배송비 3,000원이 부과됩니다.' },
  { id: 'pol:shipping-time', topic: '배송', title: '출고·도착', fact: '평일 오후 2시 이전 주문은 당일 출고되어 보통 1~2일 내 수령 가능합니다.' },
  { id: 'pol:return-window', topic: '반품', title: '교환·반품 기간', fact: '상품 수령 후 7일 이내에 교환·반품을 신청할 수 있습니다.' },
  { id: 'pol:return-change-of-mind', topic: '반품', title: '단순변심 반품', fact: '단순 변심 반품은 상품이 원상태여야 하며, 왕복 배송비가 부과될 수 있습니다.' },
  { id: 'pol:defect-return', topic: '반품', title: '하자·오배송', fact: '상품 하자나 오배송은 무료로 교환·반품됩니다.' },
  { id: 'pol:payment', topic: '결제', title: '결제수단', fact: '카드 결제(토스페이먼츠)를 지원합니다.' },
];

const json = (obj) => ({ content: [{ type: 'text', text: JSON.stringify(obj, null, 2) }] });

// 도구 1: 상품 목록 (근거 조회 대상 discover)
server.tool(
  'list_products',
  '근거를 조회할 수 있는 상품의 slug/이름 목록을 반환한다.',
  {},
  async () => {
    const rows = await prisma.product.findMany({ select: { slug: true, name: true } });
    return json(rows);
  },
);

// 도구 2: 재고·가격 근거 (DB)
server.tool(
  'get_inventory',
  '상품 slug의 재고·가격 사실을 반환한다(구매 가능 수량, 판매가, 할인, 무료배송 여부).',
  { slug: z.string().describe('상품 slug (list_products로 확인)') },
  async ({ slug }) => {
    const p = await prisma.product.findUnique({ where: { slug }, include: { inventory: true } });
    if (!p) return json({ error: '상품 없음', slug });
    const inv = p.inventory?.[0];
    const price = Number(p.price);
    const comparePrice = p.comparePrice != null ? Number(p.comparePrice) : null;
    const available = inv ? inv.available : null;
    return json({
      slug,
      name: p.name,
      price,
      comparePrice,
      discountRate: comparePrice && comparePrice > price ? Math.round((1 - price / comparePrice) * 100) : 0,
      available,
      reserved: inv ? inv.reserved : null,
      inStock: available != null && available > 0,
      freeShipping: price >= 50000,
      source: 'DB:inventory + DB:product',
    });
  },
);

// 도구 3: 정책 근거 (배송/반품/결제)
server.tool(
  'get_policy',
  '배송·교환/반품·결제 정책 조항을 반환한다. topic으로 필터 가능(배송/반품/결제).',
  { topic: z.enum(['배송', '반품', '결제']).optional().describe('선택: 특정 주제만') },
  async ({ topic }) => {
    const clauses = topic ? POLICY.filter((c) => c.topic === topic) : POLICY;
    return json({ topic: topic ?? '전체', clauses, source: '정책문서' });
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
