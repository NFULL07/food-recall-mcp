import { RecallRecord } from './types.js';
import { normName, normBarcode, parseUserDate } from './fields.js';

/** 외부로 노출되는 판정은 3가지뿐이다. 퍼지 매칭은 하지 않는다. */
export type Verdict = 'match' | 'need_more_info' | 'not_affected';

export interface MatchInput {
  productName: string;
  manufactureDate?: string;
  expiryDate?: string;
  barcode?: string;
  manufacturer?: string;
}

export interface MatchResult {
  input: MatchInput;
  verdict: Verdict;
  /** 판정 근거를 사람이 검증할 수 있게 남긴다 */
  evidence: string[];
  /** 추가로 입력하면 판정이 확정되는 항목 */
  missing: string[];
  record?: RecallRecord;
}

interface Index {
  byName: Map<string, RecallRecord[]>;
  byBarcode: Map<string, RecallRecord[]>;
}

export function buildIndex(records: RecallRecord[]): Index {
  const byName = new Map<string, RecallRecord[]>();
  const byBarcode = new Map<string, RecallRecord[]>();
  for (const r of records) {
    if (r.productNameNorm) {
      const arr = byName.get(r.productNameNorm);
      arr ? arr.push(r) : byName.set(r.productNameNorm, [r]);
    }
    if (r.barcodeNorm) {
      const arr = byBarcode.get(r.barcodeNorm);
      arr ? arr.push(r) : byBarcode.set(r.barcodeNorm, [r]);
    }
  }
  return { byName, byBarcode };
}

type DateCheck = 'in_range' | 'out_of_range' | 'unknown';

function checkDate(
  userYmd: number | null,
  range: { from: number | null; to: number | null } | null
): DateCheck {
  if (userYmd === null) return 'unknown';
  if (!range || range.from === null || range.to === null) return 'unknown';
  return userYmd >= range.from && userYmd <= range.to ? 'in_range' : 'out_of_range';
}

export function matchOne(input: MatchInput, index: Index): MatchResult {
  const evidence: string[] = [];
  const missing: string[] = [];
  let manufacturerConfirmed = false;

  // 1) 바코드 우선 (로트 식별력이 가장 높다)
  const bc = normBarcode(input.barcode);
  let candidates: RecallRecord[] = [];
  if (bc) {
    candidates = index.byBarcode.get(bc) ?? [];
    if (candidates.length) evidence.push(`바코드 ${bc} 일치`);
  }

  // 2) 바코드로 못 찾으면 제품명 완전일치
  if (!candidates.length) {
    const nm = normName(input.productName);
    if (!nm) {
      return {
        input,
        verdict: 'need_more_info',
        evidence: [],
        missing: ['product_name'],
      };
    }
    candidates = index.byName.get(nm) ?? [];
    if (candidates.length) evidence.push(`제품명 완전일치 (${candidates.length}건)`);
  }

  if (!candidates.length) {
    return {
      input,
      verdict: 'not_affected',
      evidence: ['회수·판매중지 목록에 동일한 제품명/바코드가 없음'],
      missing: [],
    };
  }

  // 3) 제조업체가 주어졌으면 대조
  if (input.manufacturer) {
    const mfNorm = normName(input.manufacturer);
    const withMf = candidates.filter((c) => c.manufacturerNorm && c.manufacturerNorm === mfNorm);
    if (withMf.length) {
      candidates = withMf;
      manufacturerConfirmed = true;
      evidence.push(`제조업체 일치 (${input.manufacturer})`);
    } else {
      const anyHasMf = candidates.some((c) => c.manufacturerNorm);
      if (anyHasMf) {
        // 같은 제품명, 다른 업체 → 단정 금지
        return {
          input,
          verdict: 'need_more_info',
          evidence: [
            ...evidence,
            '제품명은 일치하나 회수 목록의 제조업체명과 다름',
            `회수 목록 업체: ${[...new Set(candidates.map((c) => c.manufacturer).filter(Boolean))].join(', ')}`,
          ],
          missing: ['barcode'],
        };
      }
    }
  } else {
    missing.push('manufacturer');
  }

  // 4) 로트(제조일자/유통기한) 대조
  const userMfg = parseUserDate(input.manufactureDate);
  const userExp = parseUserDate(input.expiryDate);
  if (userMfg === null && userExp === null) missing.push('manufacture_date');

  let anyOutOfRange = false;

  for (const c of candidates) {
    const mfgCheck = checkDate(userMfg, c.manufactureRange);
    const expCheck = checkDate(userExp, c.expiryRange);

    if (mfgCheck === 'in_range' || expCheck === 'in_range') {
      const ev = [...evidence];
      if (mfgCheck === 'in_range') {
        ev.push(`제조일자 ${input.manufactureDate} 가 회수 대상 범위(${c.manufactureRange!.raw}) 내`);
      }
      if (expCheck === 'in_range') {
        ev.push(`유통기한 ${input.expiryDate} 가 회수 대상 범위(${c.expiryRange!.raw}) 내`);
      }
      return { input, verdict: 'match', evidence: ev, missing: [], record: c };
    }

    // 회수 레코드에 로트(제조일자/유통기한) 제한이 없으면, 규제당국이 해당
    // 제품 전체를 회수한 것이므로 "해당"으로 본다. 단, 동명이인 제품 오탐을
    // 막기 위해 제조업체 확인 또는 바코드 일치가 있을 때만 이 판정을 내린다.
    // (실데이터 355건 중 로트정보 없는 레코드가 절반 이상)
    const cHasLot =
      (c.manufactureRange !== null && c.manufactureRange.from !== null) ||
      (c.expiryRange !== null && c.expiryRange.from !== null);
    const barcodeHit = bc !== '' && c.barcodeNorm === bc;
    if (!cHasLot && (manufacturerConfirmed || barcodeHit)) {
      return {
        input,
        verdict: 'match',
        evidence: [
          ...evidence,
          barcodeHit
            ? '바코드 일치, 회수 레코드에 로트 제한 없음 → 제품 전체가 회수 대상'
            : '회수 레코드에 로트 제한이 명시되지 않아 해당 제품 전체가 회수 대상',
        ],
        missing: [],
        record: c,
      };
    }

    if (mfgCheck === 'out_of_range' || expCheck === 'out_of_range') anyOutOfRange = true;
  }

  // 5) 모든 후보가 범위 밖 → 미해당 (다른 로트)
  if (anyOutOfRange && missing.length === 0) {
    return {
      input,
      verdict: 'not_affected',
      evidence: [...evidence, '입력한 제조일자·유통기한이 회수 대상 로트 범위 밖'],
      missing: [],
      record: candidates[0],
    };
  }

  // 6) 그 외 → 추가정보 필요
  return {
    input,
    verdict: 'need_more_info',
    evidence: [...evidence, '제품명은 목록에 있으나 로트를 특정할 정보가 부족함'],
    missing: missing.length ? missing : ['manufacture_date'],
    record: candidates[0],
  };
}

export const MAX_BATCH_ITEMS = 30;

export function matchBatch(inputs: MatchInput[], index: Index) {
  const truncated = inputs.length > MAX_BATCH_ITEMS;
  const items = inputs.slice(0, MAX_BATCH_ITEMS);
  return { results: items.map((i) => matchOne(i, index)), truncated };
}
