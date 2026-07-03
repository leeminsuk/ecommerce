import { describe, it, expect } from '@jest/globals';
import {
  policyEvidence,
  inventoryEvidenceFrom,
  buildEvidence,
  scoreRelevance,
  type ProductFacts,
} from '@/lib/evidence';

const facts = (over: Partial<ProductFacts> = {}): ProductFacts => ({
  name: '테스트 헤드폰',
  price: 259000,
  comparePrice: 329000,
  status: 'PUBLISHED',
  sku: 'WH-1',
  available: 14,
  reserved: 0,
  ...over,
});

describe('policyEvidence — 정책 원자 근거', () => {
  it('안정적 고정 id 6개를 반환한다', () => {
    const ids = policyEvidence().map((e) => e.id);
    expect(ids).toEqual([
      'pol:shipping-fee',
      'pol:shipping-time',
      'pol:return-window',
      'pol:return-change-of-mind',
      'pol:defect-return',
      'pol:payment',
    ]);
  });

  it('모든 근거는 fact와 source를 갖는다', () => {
    for (const e of policyEvidence()) {
      expect(e.fact.length).toBeGreaterThan(0);
      expect(e.source).toContain('정책문서');
    }
  });
});

describe('inventoryEvidenceFrom — 재고·가격 근거 (결정적 판정)', () => {
  it('재고 충분하면 구매 가능 수량을 사실로 만든다', () => {
    const stock = inventoryEvidenceFrom(facts({ available: 14 })).find((e) => e.id === 'inv:stock')!;
    expect(stock.fact).toContain('14개');
    expect(stock.fact).not.toContain('품절');
  });

  it('재고 5개 이하는 "얼마 남지 않음"으로 판정', () => {
    const stock = inventoryEvidenceFrom(facts({ available: 3 })).find((e) => e.id === 'inv:stock')!;
    expect(stock.fact).toContain('3개');
    expect(stock.fact).toContain('얼마 남지 않');
  });

  it('재고 0은 품절로 판정', () => {
    const stock = inventoryEvidenceFrom(facts({ available: 0 })).find((e) => e.id === 'inv:stock')!;
    expect(stock.fact).toContain('품절');
  });

  it('재고 레코드 없음(null)은 확인 불가로 판정', () => {
    const stock = inventoryEvidenceFrom(facts({ available: null })).find((e) => e.id === 'inv:stock')!;
    expect(stock.fact).toContain('확인되지 않');
  });

  it('정가가 판매가보다 크면 할인율을 코드가 계산해 넣는다', () => {
    const price = inventoryEvidenceFrom(facts({ price: 259000, comparePrice: 329000 })).find(
      (e) => e.id === 'inv:price',
    )!;
    expect(price.fact).toContain('21%'); // 1 - 259000/329000 ≈ 0.2127 → 21%
    expect(price.data).toMatchObject({ price: 259000, comparePrice: 329000 });
  });

  it('정가가 없으면 할인 문구를 넣지 않는다', () => {
    const price = inventoryEvidenceFrom(facts({ comparePrice: null })).find((e) => e.id === 'inv:price')!;
    expect(price.fact).not.toContain('할인');
  });

  it('5만원 이상이면 무료배송 자격, 미만이면 배송비 부과로 판정', () => {
    const over = inventoryEvidenceFrom(facts({ price: 259000 })).find((e) => e.id === 'inv:free-shipping')!;
    expect(over.fact).toContain('무료배송');
    const under = inventoryEvidenceFrom(facts({ price: 29000 })).find((e) => e.id === 'inv:free-shipping')!;
    expect(under.fact).toContain('3,000원');
  });
});

describe('buildEvidence — 재고 + 정책 합본', () => {
  it('재고 3종 + 정책 6종을 합쳐 반환하고 id가 유일하다', () => {
    const all = buildEvidence(facts());
    expect(all).toHaveLength(9);
    const ids = all.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('scoreRelevance — 결정적 관련도', () => {
  it('키워드가 겹치면 양수, 무관하면 0', () => {
    const [stock] = inventoryEvidenceFrom(facts());
    expect(scoreRelevance(stock, '재고 남아 있나요? 구매 가능한가요')).toBeGreaterThan(0);
    expect(scoreRelevance(stock, '오늘 날씨 어때')).toBe(0);
  });

  it('반품 질문은 반품 정책 근거에 점수를 준다', () => {
    const ret = policyEvidence().find((e) => e.id === 'pol:return-window')!;
    expect(scoreRelevance(ret, '반품 며칠까지 되나요')).toBeGreaterThan(0);
  });
});
