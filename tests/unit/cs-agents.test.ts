import { describe, it, expect } from '@jest/globals';
import {
  parseClassify,
  deterministicClassify,
  parseRefund,
  deterministicRefund,
  routeCategory,
  agentMeta,
  CATEGORIES,
} from '@/lib/cs-agents';

// ── ① 분류 에이전트 파싱/정규화 ──
describe('parseClassify', () => {
  it('정상 JSON을 정규화한다', () => {
    const v = parseClassify({ category: '환불', urgency: '높음', confidence: 0.9, reason: '환불 요청' });
    expect(v).not.toBeNull();
    expect(v!.category).toBe('환불');
    expect(v!.urgency).toBe('높음');
    expect(v!.confidence).toBe(0.9);
    expect(v!.mode).toBe('llm');
  });

  it('category에 잡설이 섞여도 4종 중 하나를 뽑는다', () => {
    expect(parseClassify({ category: '이건 배송 문의입니다', confidence: 0.5 })!.category).toBe('배송');
  });

  it('category를 못 뽑으면 null (라우트가 결정적 폴백)', () => {
    expect(parseClassify({ category: '알수없음', confidence: 0.5 })).toBeNull();
    expect(parseClassify({})).toBeNull();
    expect(parseClassify(null)).toBeNull();
    expect(parseClassify('그냥 문자열')).toBeNull();
  });

  it('confidence를 0~1로 클램프하고, 잘못되면 기본값', () => {
    expect(parseClassify({ category: '상품', confidence: 5 })!.confidence).toBe(1);
    expect(parseClassify({ category: '상품', confidence: -2 })!.confidence).toBe(0);
    expect(parseClassify({ category: '상품', confidence: 'x' })!.confidence).toBe(0.7);
  });

  it('urgency가 이상하면 보통으로', () => {
    expect(parseClassify({ category: '기타', urgency: '몰라' })!.urgency).toBe('보통');
  });
});

describe('deterministicClassify', () => {
  it('환불 신호를 우선 잡는다 (배송비 환불도 환불)', () => {
    expect(deterministicClassify('', '배송비 환불해주세요').category).toBe('환불');
    expect(deterministicClassify('', '파손돼서 왔어요').category).toBe('환불');
  });
  it('배송/상품 키워드를 분류한다', () => {
    expect(deterministicClassify('', '언제 도착하나요').category).toBe('배송');
    expect(deterministicClassify('', '재고 남았나요 가격 얼마').category).toBe('상품');
  });
  it('키워드 없으면 기타 + 낮은 확신', () => {
    const v = deterministicClassify('', '안녕하세요 반갑습니다');
    expect(v.category).toBe('기타');
    expect(v.confidence).toBeLessThan(0.5);
  });
  it('긴급 신호로 긴급도 높음', () => {
    expect(deterministicClassify('', '지금 당장 환불해').urgency).toBe('높음');
    expect(deterministicClassify('', '재고 있나요').urgency).toBe('보통');
  });
  it('항상 mode=deterministic', () => {
    expect(deterministicClassify('', '아무거나').mode).toBe('deterministic');
  });
});

// ── 라우팅 ──
describe('routeCategory', () => {
  it('환불만 refund, 나머지는 answer', () => {
    expect(routeCategory('환불')).toBe('refund');
    expect(routeCategory('배송')).toBe('answer');
    expect(routeCategory('상품')).toBe('answer');
    expect(routeCategory('기타')).toBe('answer');
  });
});

// ── ③ 환불 판정 에이전트 ──
describe('parseRefund', () => {
  it('정상 판정을 정규화한다', () => {
    const v = parseRefund({ decision: '가능', reason: '하자', policyBasis: '하자 정책' });
    expect(v!.decision).toBe('가능');
    expect(v!.mode).toBe('llm');
  });
  it('decision에 잡설이 섞여도 3종 중 하나', () => {
    expect(parseRefund({ decision: '환불 가능합니다' })!.decision).toBe('가능');
    expect(parseRefund({ decision: '불가능' })!.decision).toBe('불가');
  });
  it('decision 없으면 null', () => {
    expect(parseRefund({ reason: 'x' })).toBeNull();
    expect(parseRefund(null)).toBeNull();
  });
});

describe('deterministicRefund', () => {
  it('하자·오배송은 상태 무관 가능', () => {
    expect(deterministicRefund('PENDING', '파손돼서 왔어요').decision).toBe('가능');
    expect(deterministicRefund(null, '불량이에요').decision).toBe('가능');
  });
  it('배송완료 단순변심은 추가확인 (7일 확인)', () => {
    const v = deterministicRefund('DELIVERED', '단순 변심입니다');
    expect(v.decision).toBe('추가확인');
  });
  it('주문 없으면 추가확인', () => {
    expect(deterministicRefund(null, '환불해주세요').decision).toBe('추가확인');
  });
  it('배송 전 상태는 추가확인', () => {
    expect(deterministicRefund('PAID', '환불').decision).toBe('추가확인');
  });
});

// ── 에이전트 레지스트리 ──
describe('agentMeta', () => {
  it('역할별 메타를 반환한다', () => {
    expect(agentMeta('classifier').name).toBe('분류 에이전트');
    expect(agentMeta('answer').name).toBe('답변 에이전트');
    expect(agentMeta('refund').name).toBe('환불 판정 에이전트');
  });
});

describe('CATEGORIES', () => {
  it('정확히 4종', () => {
    expect(CATEGORIES).toEqual(['배송', '상품', '환불', '기타']);
  });
});
