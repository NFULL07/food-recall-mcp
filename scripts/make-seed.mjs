#!/usr/bin/env node
/**
 * 식품안전나라 I0490 전량을 받아 data/seed.json 으로 저장한다.
 * API가 살아있을 때 실행:  FOODSAFETYKOREA_API_KEY=키 npm run seed
 */
import { writeFileSync, mkdirSync } from 'node:fs';

const KEY = process.env.FOODSAFETYKOREA_API_KEY;
if (!KEY) {
  console.error('FOODSAFETYKOREA_API_KEY 환경변수가 필요합니다.');
  process.exit(1);
}
const url = `https://openapi.foodsafetykorea.go.kr/api/${KEY}/I0490/json/1/1000`;
const j = await fetch(url, { signal: AbortSignal.timeout(20000) }).then((r) => r.json());
const code = j?.I0490?.RESULT?.CODE;
if (code && code !== 'INFO-000' && code !== 'INFO-200') {
  console.error(`API 오류: ${code} ${j?.I0490?.RESULT?.MSG ?? ''}`);
  process.exit(1);
}
const rows = j?.I0490?.row ?? [];
if (!rows.length) {
  console.error('0건 응답 → seed 생성 취소(덮어쓰지 않음).');
  process.exit(1);
}
mkdirSync('data', { recursive: true });
const out = { capturedAt: new Date().toISOString(), origin: 'domestic', count: rows.length, rows };
writeFileSync('data/seed.json', JSON.stringify(out));
console.log(`seed 생성 완료: ${rows.length}건 → data/seed.json`);
