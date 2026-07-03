// 근거(Evidence) 층 — 재고데이터(DB)와 정책데이터(상수)를 "원자적 근거"로 결정적 변환.
//
// 판정·표현 분리 원칙: 근거의 수집·구성은 전적으로 코드가 한다(LLM 없음). 모든 모델이
// 같은 근거 세트를 공유하므로 어떤 모델을 쓰든 '무엇을 근거로 답했는가'가 동일하다.
// 각 근거는 안정적인 id(inv:stock, pol:return-window …)를 가져 검증·인용의 단위가 된다.

// 이 모듈은 순수(no DB) — 유닛 테스트가 Prisma 없이 근거 구성/점수를 검증할 수 있다.
// 실제 DB 조회로 근거 세트를 만드는 buildEvidenceSet은 lib/evidence-db.ts에 있다.

export type EvidenceKind = 'inventory' | 'pricing' | 'policy';

export interface Evidence {
  /** 안정적 인용 id (예: 'inv:stock', 'pol:return-window') — 검증·인용의 단위 */
  id: string;
  kind: EvidenceKind;
  /** 짧은 라벨 (UI 칩) */
  title: string;
  /** 원자적 사실 문장 — 모델은 이 문장만 근거로 삼는다 */
  fact: string;
  /** 출처 표기 (DB:inventory / 정책문서:교환·반품 …) */
  source: string;
  /** 결정적 관련도 점수·폴백에 쓰는 키워드 (프롬프트에는 보내지 않음) */
  keywords: string[];
  /** 수치 백킹 (재고 수량·가격 등) — 표현이 숫자를 지어내지 못하게 */
  data?: Record<string, unknown>;
}

const won = (n: number) => '₩' + Math.round(n).toLocaleString('ko-KR');

// ── 정책 근거: STORE_POLICY 문서를 원자 조항으로 분해 (결정적·고정 id) ──
export function policyEvidence(): Evidence[] {
  return [
    {
      id: 'pol:shipping-fee',
      kind: 'policy',
      title: '배송비',
      fact: '5만원 이상 구매 시 무료배송이며, 미만이면 배송비 3,000원이 부과됩니다.',
      source: '정책문서:배송',
      keywords: ['배송', '배송비', '무료', '얼마', '비용', '택배'],
    },
    {
      id: 'pol:shipping-time',
      kind: 'policy',
      title: '출고·도착',
      fact: '평일 오후 2시 이전 주문은 당일 출고되어 보통 1~2일 내 수령 가능합니다.',
      source: '정책문서:배송',
      keywords: ['배송', '언제', '도착', '출고', '며칠', '얼마나', '기간', '빨리'],
    },
    {
      id: 'pol:return-window',
      kind: 'policy',
      title: '교환·반품 기간',
      fact: '상품 수령 후 7일 이내에 교환·반품을 신청할 수 있습니다.',
      source: '정책문서:교환·반품',
      keywords: ['반품', '교환', '환불', '기간', '며칠', '기한', '취소'],
    },
    {
      id: 'pol:return-change-of-mind',
      kind: 'policy',
      title: '단순변심 반품',
      fact: '단순 변심 반품은 상품이 원상태여야 하며, 왕복 배송비가 부과될 수 있습니다.',
      source: '정책문서:교환·반품',
      keywords: ['변심', '반품', '환불', '배송비', '취소', '단순'],
    },
    {
      id: 'pol:defect-return',
      kind: 'policy',
      title: '하자·오배송',
      fact: '상품 하자나 오배송은 무료로 교환·반품됩니다.',
      source: '정책문서:교환·반품',
      keywords: ['하자', '불량', '고장', '오배송', '파손', '반품', '교환', '무료'],
    },
    {
      id: 'pol:payment',
      kind: 'policy',
      title: '결제수단',
      fact: '카드 결제(토스페이먼츠)를 지원합니다.',
      source: '정책문서:결제',
      keywords: ['결제', '카드', '페이', '토스', '지불', '무통장'],
    },
  ];
}

// ── 재고·가격 근거: 상품 + 인벤토리 레코드에서 결정적으로 생성 ──
export interface ProductFacts {
  name: string;
  price: number;
  comparePrice?: number | null;
  status: string;
  sku?: string | null;
  available: number | null; // Inventory.available (없으면 null)
  reserved: number | null;
}

export function inventoryEvidenceFrom(p: ProductFacts): Evidence[] {
  const ev: Evidence[] = [];

  // 재고 상태 — available 수량으로 결정적 판정 (LLM이 재고를 지어내지 못하게)
  const avail = p.available;
  let stockFact: string;
  if (avail === null) {
    stockFact = `${p.name}의 실시간 재고 수량은 확인되지 않습니다(재고 레코드 없음).`;
  } else if (avail <= 0) {
    stockFact = `${p.name}은(는) 현재 품절 상태로 구매할 수 없습니다.`;
  } else if (avail <= 5) {
    stockFact = `${p.name}의 구매 가능 재고는 ${avail}개로 얼마 남지 않았습니다.`;
  } else {
    stockFact = `${p.name}은(는) 재고가 있으며 구매 가능 수량은 ${avail}개입니다.`;
  }
  ev.push({
    id: 'inv:stock',
    kind: 'inventory',
    title: '재고',
    fact: stockFact,
    source: 'DB:inventory',
    keywords: ['재고', '품절', '구매', '살', '있나', '수량', '주문', '남'],
    data: { available: avail, reserved: p.reserved },
  });

  // 가격 근거 — 정가 대비 할인율을 코드가 계산
  let priceFact = `${p.name}의 판매가는 ${won(p.price)}입니다.`;
  if (p.comparePrice && p.comparePrice > p.price) {
    const rate = Math.round((1 - p.price / p.comparePrice) * 100);
    priceFact += ` 정가 ${won(p.comparePrice)}에서 ${rate}% 할인된 가격입니다.`;
  }
  ev.push({
    id: 'inv:price',
    kind: 'pricing',
    title: '가격',
    fact: priceFact,
    source: 'DB:product',
    keywords: ['가격', '얼마', '할인', '세일', '값', '금액', '비싸', '싸'],
    data: { price: p.price, comparePrice: p.comparePrice ?? null },
  });

  // 무료배송 자격 — 가격과 정책 임계(5만원)를 코드가 대조 (근거 간 결합도 결정적으로)
  const freeShip = p.price >= 50000;
  ev.push({
    id: 'inv:free-shipping',
    kind: 'pricing',
    title: '이 상품 배송비',
    fact: freeShip
      ? `${p.name}은(는) 판매가가 5만원 이상이라 무료배송 대상입니다.`
      : `${p.name}은(는) 판매가가 5만원 미만이라 배송비 3,000원이 부과됩니다.`,
    source: 'DB:product + 정책문서:배송',
    keywords: ['배송', '배송비', '무료', '택배'],
    data: { price: p.price, freeShipping: freeShip },
  });

  return ev;
}

// ── 결정적 관련도 점수: 질문과 근거 키워드의 겹침 (검증 폴백·랭킹용) ──
export function scoreRelevance(ev: Evidence, question: string): number {
  const q = question.toLowerCase();
  let score = 0;
  for (const k of ev.keywords) {
    if (q.includes(k.toLowerCase())) score += 1;
  }
  return score;
}

// ── ① 구성(Construct): 상품 사실 → 전체 후보 근거 세트 (재고 + 가격 + 정책) ──
// 이 반환이 곧 모든 모델이 공유하는 '근거'다. LLM은 개입하지 않는다.
export function buildEvidence(facts: ProductFacts): Evidence[] {
  return [...inventoryEvidenceFrom(facts), ...policyEvidence()];
}

/** 프롬프트·인용에 쓰는 공개 표현 (keywords·내부 data는 제외) */
export function toPublicEvidence(ev: Evidence) {
  return { id: ev.id, kind: ev.kind, title: ev.title, fact: ev.fact, source: ev.source };
}
