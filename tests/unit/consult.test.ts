import { describe, it, expect } from '@jest/globals';
import {
  parseGrounding,
  deterministicVerify,
  parseAnswer,
  deterministicAnswer,
  citedEvidence,
} from '@/lib/consult';
import { buildEvidence, type ProductFacts } from '@/lib/evidence';

const facts: ProductFacts = {
  name: '테스트 헤드폰',
  price: 259000,
  comparePrice: 329000,
  status: 'PUBLISHED',
  sku: 'WH-1',
  available: 14,
  reserved: 0,
};
const EV = buildEvidence(facts); // 9종 (inv:stock, inv:price, inv:free-shipping, pol:*)

describe('parseGrounding — 검증(grounding) 파싱 + 환각 id 게이트', () => {
  it('존재하는 id만 남기고 없는 id는 버린다', () => {
    const v = parseGrounding(
      { groundedIds: ['inv:stock', 'pol:nonexistent', 'inv:price'], sufficient: true, reason: 'ok' },
      EV,
    )!;
    expect(v.groundedIds).toEqual(['inv:stock', 'inv:price']); // 환각 id 제거
    expect(v.sufficient).toBe(true);
    expect(v.mode).toBe('llm');
  });

  it('유효 grounded id가 0이면 sufficient는 false로 강제된다', () => {
    const v = parseGrounding({ groundedIds: ['ghost'], sufficient: true, reason: 'x' }, EV)!;
    expect(v.groundedIds).toEqual([]);
    expect(v.sufficient).toBe(false);
  });

  it('객체가 아니면 null (라우트가 폴백)', () => {
    expect(parseGrounding(null, EV)).toBeNull();
    expect(parseGrounding('nope', EV)).toBeNull();
  });
});

describe('deterministicVerify — 결정적 grounding 폴백', () => {
  it('재고 질문은 재고 근거를 grounding한다', () => {
    const v = deterministicVerify(EV, '재고 남아 있나요 구매 가능?');
    expect(v.groundedIds).toContain('inv:stock');
    expect(v.sufficient).toBe(true);
    expect(v.mode).toBe('deterministic');
  });

  it('무관한 질문은 grounding 없음 → 불충분', () => {
    const v = deterministicVerify(EV, '오늘 서울 날씨 알려줘');
    expect(v.groundedIds).toEqual([]);
    expect(v.sufficient).toBe(false);
  });
});

describe('parseAnswer — Evidence-Lock 발행 게이트', () => {
  const grounded = ['inv:stock', 'inv:price'];

  it('검증 집합 밖 인용은 제거한다', () => {
    const a = parseAnswer(
      { answer: '재고 있고 가격은 …', citedIds: ['inv:stock', 'pol:payment'], needHuman: false },
      grounded,
    )!;
    expect(a.citedIds).toEqual(['inv:stock']); // pol:payment는 검증 밖 → 제거
    expect(a.needHuman).toBe(false);
  });

  it('인용이 하나도 남지 않으면 needHuman=true (근거 없는 답 차단)', () => {
    const a = parseAnswer({ answer: '아무말', citedIds: ['pol:payment'], needHuman: false }, grounded)!;
    expect(a.citedIds).toEqual([]);
    expect(a.needHuman).toBe(true);
  });

  it('답변 문자열이 비면 needHuman=true', () => {
    const a = parseAnswer({ answer: '   ', citedIds: ['inv:stock'], needHuman: false }, grounded)!;
    expect(a.needHuman).toBe(true);
  });

  it('모델이 needHuman을 요청하면 그대로 존중', () => {
    const a = parseAnswer({ answer: '음', citedIds: ['inv:stock'], needHuman: true }, grounded)!;
    expect(a.needHuman).toBe(true);
  });

  it('객체가 아니면 null', () => {
    expect(parseAnswer(undefined, grounded)).toBeNull();
  });
});

describe('deterministicAnswer — 결정적 대답 폴백', () => {
  it('검증된 근거 문장을 엮고 그 id를 인용한다', () => {
    const grounded = EV.filter((e) => ['inv:stock', 'inv:price'].includes(e.id));
    const a = deterministicAnswer(grounded);
    expect(a.needHuman).toBe(false);
    expect(a.citedIds).toEqual(['inv:stock', 'inv:price']);
    expect(a.answer).toContain('재고');
  });

  it('검증된 근거가 없으면 상담원 연결(needHuman)', () => {
    const a = deterministicAnswer([]);
    expect(a.needHuman).toBe(true);
    expect(a.citedIds).toEqual([]);
  });
});

describe('citedEvidence — 인용 id → 표시용 근거', () => {
  it('id 순서대로 공개 필드만 매핑하고 없는 id는 건너뛴다', () => {
    const out = citedEvidence(EV, ['inv:price', 'ghost', 'inv:stock']);
    expect(out.map((e) => e.id)).toEqual(['inv:price', 'inv:stock']);
    expect(out[0]).toHaveProperty('fact');
    expect(out[0]).not.toHaveProperty('keywords'); // 내부 필드 비노출
  });
});
