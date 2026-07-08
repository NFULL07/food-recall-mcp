#!/usr/bin/env node
/**
 * 스키마 탐색. 컨테이너가 아니라 "주완 님 로컬"에서 돌린다.
 *
 *   node scripts/probe.mjs                 # 인증키 없이 샘플만 (지금 바로 가능)
 *   FOODSAFETYKOREA_API_KEY=xxx node scripts/probe.mjs
 *   MFDS_DOMESTIC_URL=... DATA_GO_KR_KEY=xxx node scripts/probe.mjs
 *
 * 확인할 것 딱 네 가지
 *   1. 실제 필드명
 *   2. 전체 건수
 *   3. 바코드번호 채움률
 *   4. 제조일자 / 유통기한 형식 (단일값인가 범위인가)
 */

const KEY = process.env.DATA_GO_KR_KEY ?? '';
const FS_KEY = process.env.FOODSAFETYKOREA_API_KEY ?? KEY;

const BARCODE_KEYS = ['BRCDNO', 'BAR_CD', 'BARCD', 'BRCD_NO', '바코드번호', 'barcode'];
const MFG_KEYS = ['MNFDT', 'MANUFACTURE_DT', 'MNFCTUR_DT', 'PRDUCT_DT', '제조일자'];
const EXP_KEYS = ['DISTBTMLMT', 'DISTB_TMLMT', 'POG_DAYCNT', 'USE_DT', '유통기한'];

const firstKey = (obj, keys) => keys.find((k) => obj[k] !== undefined && String(obj[k]).trim() !== '');
const val = (obj, keys) => {
  const k = firstKey(obj, keys);
  return k ? String(obj[k]).trim() : '';
};

function classifyDate(s) {
  if (!s) return 'empty';
  const hits = s.match(/\d{4}[.\-/]?\d{2}[.\-/]?\d{2}/g) ?? [];
  if (hits.length === 0) return `unparsed(${s.slice(0, 24)})`;
  if (hits.length === 1) return 'single';
  return 'range';
}

async function getJson(url, label) {
  const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
  const body = await res.text();
  if (!res.ok) throw new Error(`${label} HTTP ${res.status}\n${body.slice(0, 300)}`);
  try {
    return JSON.parse(body);
  } catch {
    throw new Error(`${label} JSON 아님. 응답 앞부분:\n${body.slice(0, 400)}`);
  }
}

function report(label, rows, total) {
  console.log(`\n${'='.repeat(60)}\n${label}\n${'='.repeat(60)}`);
  if (!rows.length) return console.log('행 없음');

  console.log(`전체 건수: ${total ?? '(미제공)'}`);
  console.log(`샘플 행 수: ${rows.length}`);

  console.log('\n[실제 필드명]');
  console.log(Object.keys(rows[0]).join(', '));

  console.log('\n[첫 행 원문]');
  console.log(JSON.stringify(rows[0], null, 2).slice(0, 1200));

  const bcKey = firstKey(rows[0], BARCODE_KEYS);
  const bcFilled = rows.filter((r) => val(r, BARCODE_KEYS)).length;
  console.log(`\n[바코드]  키=${bcKey ?? '없음'}  채움 ${bcFilled}/${rows.length} (${Math.round((bcFilled / rows.length) * 100)}%)`);

  const mfgKey = firstKey(rows[0], MFG_KEYS);
  const expKey = firstKey(rows[0], EXP_KEYS);
  const tally = (keys) => {
    const c = {};
    for (const r of rows) {
      const t = classifyDate(val(r, keys));
      c[t] = (c[t] ?? 0) + 1;
    }
    return c;
  };
  console.log(`[제조일자] 키=${mfgKey ?? '없음'}  형식=${JSON.stringify(tally(MFG_KEYS))}`);
  console.log(`  예: ${rows.slice(0, 3).map((r) => JSON.stringify(val(r, MFG_KEYS))).join(', ')}`);
  console.log(`[유통기한] 키=${expKey ?? '없음'}  형식=${JSON.stringify(tally(EXP_KEYS))}`);
  console.log(`  예: ${rows.slice(0, 3).map((r) => JSON.stringify(val(r, EXP_KEYS))).join(', ')}`);

  console.log('\n[판단]');
  const pct = (bcFilled / rows.length) * 100;
  if (pct >= 70) console.log('  바코드 채움률 충분 → check_recall_by_barcode 를 주력으로 써도 된다.');
  else if (pct >= 20) console.log('  바코드 채움률 보통 → 바코드는 보조. 제품명+제조일자+업체명 3중 대조를 메인으로.');
  else console.log('  ⚠️ 바코드 채움률 낮음 → check_recall_by_barcode 는 보조 도구로 내리고, 3중 대조를 메인으로 할 것.');
}

async function probeFoodSafety() {
  // 인증키 없이도 가능한 공식 샘플
  const sampleUrl = 'https://openapi.foodsafetykorea.go.kr/api/sample/I0490/json/1/5';
  const j = await getJson(sampleUrl, 'foodsafety sample');
  report('식품안전나라 I0490 (샘플, 인증키 불필요)', j?.I0490?.row ?? [], j?.I0490?.total_count);

  if (!FS_KEY) {
    console.log('\n※ FOODSAFETYKOREA_API_KEY 없음 → 실데이터 100건 확인은 건너뜀');
    return;
  }
  const realUrl = `https://openapi.foodsafetykorea.go.kr/api/${FS_KEY}/I0490/json/1/100`;
  const r = await getJson(realUrl, 'foodsafety real');
  report('식품안전나라 I0490 (실데이터 100건)', r?.I0490?.row ?? [], r?.I0490?.total_count);
}

async function probeDataGoKr(label, baseUrl) {
  if (!baseUrl) return;
  if (!KEY) return console.log(`\n※ DATA_GO_KR_KEY 없음 → ${label} 건너뜀`);
  const u = new URL(baseUrl);
  u.searchParams.set('serviceKey', KEY);
  u.searchParams.set('pageNo', '1');
  u.searchParams.set('numOfRows', '100');
  u.searchParams.set('type', 'json');
  const j = await getJson(u.toString(), label);
  const items = j?.response?.body?.items;
  const rows = Array.isArray(items) ? items : Array.isArray(items?.item) ? items.item : [];
  report(label, rows, j?.response?.body?.totalCount);
}

const run = async () => {
  try {
    await probeFoodSafety();
  } catch (e) {
    console.error('\n[식품안전나라 실패]', e.message);
  }
  try {
    await probeDataGoKr('data.go.kr 15074318 (국내)', process.env.MFDS_DOMESTIC_URL);
  } catch (e) {
    console.error('\n[국내 실패]', e.message);
  }
  try {
    await probeDataGoKr('data.go.kr 15095378 (수입)', process.env.MFDS_IMPORTED_URL);
  } catch (e) {
    console.error('\n[수입 실패]', e.message);
  }
  console.log('\n\n확인 후 src/mfds/fields.ts 의 CANDIDATES 맨 앞에 실제 키를 넣으세요.');
};

run();
