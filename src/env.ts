/**
 * .env 파일이 있으면 로드한다(로컬 개발용). 외부 의존성 없음.
 * 배포 환경(카카오 클라우드 등)은 플랫폼 환경변수를 직접 쓰므로 .env가 없어도 정상 동작.
 * 이미 존재하는 process.env 값은 덮어쓰지 않는다(실제 환경변수 우선).
 *
 * 반드시 config.ts 보다 먼저 평가되어야 하므로 server.ts 의 최상단에서 import 한다.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

try {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(here, '../.env'), // dist/env.js -> 프로젝트 루트
    resolve(here, '.env'),
    resolve(process.cwd(), '.env'),
  ];
  let text: string | null = null;
  for (const p of candidates) {
    try {
      text = readFileSync(p, 'utf8');
      break;
    } catch {
      /* 다음 후보 */
    }
  }
  if (text) {
    for (const line of text.split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const eq = t.indexOf('=');
      if (eq === -1) continue;
      const k = t.slice(0, eq).trim();
      let v = t.slice(eq + 1).trim();
      if (
        (v.startsWith('"') && v.endsWith('"')) ||
        (v.startsWith("'") && v.endsWith("'"))
      ) {
        v = v.slice(1, -1);
      }
      if (!(k in process.env)) process.env[k] = v;
    }
  }
} catch {
  /* .env 로딩 실패는 치명적이지 않다 */
}
