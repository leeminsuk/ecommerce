// 근거 층의 DB 조회부 — Product + Inventory를 읽어 순수 빌더(lib/evidence)로 근거 세트를 만든다.
// MCP 서버(mcp/commerce-server.mjs)와 상담 라우트가 같은 근거를 쓰도록 여기 한 곳으로 모은다.

import prisma from '@/lib/prisma';
import { buildEvidence, type Evidence, type ProductFacts } from '@/lib/evidence';

/** slug 상품의 사실(재고·가격·상태) — MCP·라우트 공용 */
export async function productFacts(slug: string): Promise<ProductFacts | null> {
  const product = await prisma.product.findUnique({
    where: { slug },
    include: { inventory: true },
  });
  if (!product) return null;
  const inv = product.inventory?.[0];
  return {
    name: product.name,
    price: Number(product.price),
    comparePrice: product.comparePrice != null ? Number(product.comparePrice) : null,
    status: product.status,
    sku: product.sku,
    available: inv ? inv.available : null,
    reserved: inv ? inv.reserved : null,
  };
}

/** ① 구성: slug 상품의 전체 근거 세트 (없으면 null) */
export async function buildEvidenceSet(slug: string): Promise<Evidence[] | null> {
  const facts = await productFacts(slug);
  if (!facts) return null;
  return buildEvidence(facts);
}
