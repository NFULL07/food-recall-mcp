import { toRecord } from '../src/mfds/types.js';
import { buildIndex, matchOne } from '../src/mfds/match.js';

const raw = [
  {
    RTRVL_SN: '1001',
    PRDLST_NM: '초코칩 쿠키',
    BSSH_NM: '가나식품',
    BAR_CD: '8801234567890',
    MANUFACTURE_DT: '2026-05-01~2026-05-20',
    DISTB_TMLMT: '2026-11-01~2026-11-20',
    RTRVL_RESN: '이물(금속) 혼입',
    RTRVL_GRAD: '2등급',
    PRDLST_DCNM: '과자류',
  },
  {
    RTRVL_SN: '1002',
    PRDLST_NM: '초코칩 쿠키',
    BSSH_NM: '다라제과',
    MANUFACTURE_DT: '20260610',
    RTRVL_RESN: '기준규격 부적합',
    RTRVL_GRAD: '3등급',
  },
  {
    RTRVL_SN: '2001',
    PRDLST_NM: '멸균우유 1L',
    BSSH_NM: '마바유업',
    BAR_CD: '8809999911111',
    RTRVL_RESN: '세균수 초과',
    RTRVL_GRAD: '1등급',
  },
];

const records = raw.map((r) => toRecord(r, 'domestic')!).filter(Boolean);
const index = buildIndex(records);

const cases: Array<[string, any, string]> = [
  ['범위 내 제조일자 → 해당', { productName: '초코칩 쿠키', manufacturer: '가나식품', manufactureDate: '2026-05-12' }, 'match'],
  ['범위 밖 제조일자 → 미해당', { productName: '초코칩 쿠키', manufacturer: '가나식품', manufactureDate: '2026-04-30' }, 'not_affected'],
  ['제조일자 없음 → 추가정보 필요', { productName: '초코칩 쿠키', manufacturer: '가나식품' }, 'need_more_info'],
  ['목록에 없는 제품 → 미해당', { productName: '바나나우유', manufactureDate: '2026-05-12' }, 'not_affected'],
  ['업체 불일치 → 추가정보 필요(단정 금지)', { productName: '초코칩 쿠키', manufacturer: '전혀다른식품', manufactureDate: '2026-05-12' }, 'need_more_info'],
  ['바코드 일치 + 로트정보 없음 → 해당', { productName: '멸균우유 1L', barcode: '880-9999-911111' }, 'match'],
  ['표기 흔들림(공백/대소문자) 흡수', { productName: ' 초코칩쿠키 ', manufacturer: '가나식품', manufactureDate: '2026-05-20' }, 'match'],
  ['단일일자 레코드, 정확히 일치 → 해당', { productName: '초코칩 쿠키', manufacturer: '다라제과', manufactureDate: '2026-06-10' }, 'match'],
  ['단일일자 레코드, 하루 차이 → 미해당', { productName: '초코칩 쿠키', manufacturer: '다라제과', manufactureDate: '2026-06-11' }, 'not_affected'],
  ['로트제한 없는 회수 + 업체일치 → 해당(제품전체)', { productName: '멸균우유 1L', manufacturer: '마바유업' }, 'match'],
  ['로트제한 없는 회수, 업체 미입력 → 추가정보 필요(오탐방지)', { productName: '멸균우유 1L' }, 'need_more_info'],
];

let pass = 0;
for (const [name, input, expected] of cases) {
  const r = matchOne(input, index);
  const ok = r.verdict === expected;
  if (ok) pass++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  console.log(`      → ${r.verdict}${ok ? '' : ` (기대: ${expected})`}`);
  if (r.evidence.length) console.log(`      근거: ${r.evidence.join(' | ')}`);
  if (r.missing.length) console.log(`      필요: ${r.missing.join(', ')}`);
}
console.log(`\n${pass}/${cases.length} passed`);
process.exit(pass === cases.length ? 0 : 1);
