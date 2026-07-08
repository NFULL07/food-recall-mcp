/**
 * 실데이터 스키마 고정 검증 (2026-07-08 확보한 I0490 샘플 5행 기준).
 * 네트워크 없이, 실제 응답 필드명이 fields.ts 에 제대로 물리는지 확인한다.
 */
import { parseDateRange } from '../src/mfds/fields.js';
import { toRecord } from '../src/mfds/types.js';

// 실제 I0490 샘플 응답에서 그대로 가져온 5행 (필드명 원본 유지)
const SAMPLE = [
  {
    RTRVLDSUSE_SEQ: '3000228307', PRDTNM: '냉동만두피', BSSHNM: '태산식품',
    BRCDNO: '', MNFDT: '2026-06-26', DISTBTMLMT: '제조일로부터 9개월',
    RTRVLPRVNS: '세균수 기준 규격 부적합', RTRVL_GRDCD_NM: '3등급', PRDLST_CD_NM: '만두피',
  },
  {
    RTRVLDSUSE_SEQ: '3000228060', PRDTNM: '프리미엄 대두레시틴 골드 플러스', BSSHNM: '(주)아오스',
    BRCDNO: '8809001239653', MNFDT: '데이터없음', DISTBTMLMT: '2028.5.26',
    RTRVLPRVNS: '자가품질위탁검사 부적합', RTRVL_GRDCD_NM: '3등급', PRDLST_CD_NM: '레시틴',
  },
  {
    RTRVLDSUSE_SEQ: '3000227960', PRDTNM: '소다홉', BSSHNM: '에이홉(A HOP COMPANY)',
    BRCDNO: '8809907800186', MNFDT: '2025-11-03', DISTBTMLMT: '제조일로부터 24개월',
    RTRVLPRVNS: '세균수 기준 규격 부적합', RTRVL_GRDCD_NM: '3등급', PRDLST_CD_NM: '탄산음료',
  },
  {
    RTRVLDSUSE_SEQ: '3000227952', PRDTNM: '명품갈비탕 기본맛', BSSHNM: '앰엔제이fnb',
    BRCDNO: '', MNFDT: '2026-06-20', DISTBTMLMT: '제조일로부터 12개월',
    RTRVLPRVNS: '대장균 기준 규격 부적합', RTRVL_GRDCD_NM: '3등급', PRDLST_CD_NM: '즉석조리식품',
  },
  {
    RTRVLDSUSE_SEQ: '3000227890', PRDTNM: '닭꼬치', BSSHNM: '미광식품',
    BRCDNO: '', MNFDT: '2025-11-04 ~ 2026-5-19', DISTBTMLMT: '2026-11-03 ~ 2027-05-18',
    RTRVLPRVNS: '알레르기 유발물질 미표시', RTRVL_GRDCD_NM: '1등급', PRDLST_CD_NM: '양념육',
  },
];

let pass = 0, fail = 0;
const check = (name: string, cond: boolean, got?: unknown) => {
  if (cond) { pass++; console.log(`PASS  ${name}`); }
  else { fail++; console.log(`FAIL  ${name}   got=${JSON.stringify(got)}`); }
};

// --- 필드 매핑 ---
const recs = SAMPLE.map((r) => toRecord(r as any, 'domestic')!);
check('5행 모두 레코드화(제품명 매핑)', recs.length === 5 && recs.every((r) => r.productName), recs.map((r) => r?.productName));
check('제품명 PRDTNM 매핑', recs[0].productName === '냉동만두피', recs[0].productName);
check('업체 BSSHNM 매핑', recs[0].manufacturer === '태산식품', recs[0].manufacturer);
check('바코드 BRCDNO 매핑(채워진 행)', recs[1].barcode === '8809001239653', recs[1].barcode);
check('회수사유 RTRVLPRVNS 매핑', recs[0].reason === '세균수 기준 규격 부적합', recs[0].reason);
check('회수등급 RTRVL_GRDCD_NM 매핑', recs[4].grade === '1등급', recs[4].grade);
check('품목명 PRDLST_CD_NM 매핑', recs[0].category === '만두피', recs[0].category);

// --- "데이터없음" 플레이스홀더 → 빈 값(범위 null) ---
check('MNFDT "데이터없음" → manufactureRange null', recs[1].manufactureRange === null, recs[1].manufactureRange);

// --- 날짜 파싱: 단일값 ---
check('MNFDT 단일 "2026-06-26" → 20260626', recs[0].manufactureRange?.from === 20260626 && recs[0].manufactureRange?.to === 20260626, recs[0].manufactureRange);

// --- 날짜 파싱: 한 자리 월/일 단일 "2028.5.26" ---
check('DISTBTMLMT "2028.5.26" → 20280526', recs[1].expiryRange?.from === 20280526, recs[1].expiryRange);

// --- 날짜 파싱: 한 자리 월 섞인 범위 "2025-11-04 ~ 2026-5-19" ---
check('MNFDT 범위(한자리월) from=20251104', recs[4].manufactureRange?.from === 20251104, recs[4].manufactureRange);
check('MNFDT 범위(한자리월) to=20260519', recs[4].manufactureRange?.to === 20260519, recs[4].manufactureRange);

// --- 상대표현은 날짜 아님 ---
check('DISTBTMLMT "제조일로부터 9개월" → 범위 없음', recs[0].expiryRange?.from === null && recs[0].expiryRange?.to === null, recs[0].expiryRange);

// --- 범위 파싱 직접 확인 ---
const r1 = parseDateRange('2026-11-03 ~ 2027-05-18');
check('범위 "2026-11-03 ~ 2027-05-18" 정렬', r1?.from === 20261103 && r1?.to === 20270518, r1);

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail === 0 ? 0 : 1);
