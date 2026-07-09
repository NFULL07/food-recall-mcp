import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { activeSources, REFRESH_INTERVAL_MS, SourceConfig } from './config.js';
import { Origin, RecallRecord, toRecord } from './types.js';
import { buildIndex } from './match.js';

interface Snapshot {
  records: RecallRecord[];
  index: ReturnType<typeof buildIndex>;
  byManufacturer: Map<string, RecallRecord[]>;
  bySerial: Map<string, RecallRecord>;
  loadedAt: Date;
  sources: string[];
}

let snapshot: Snapshot | null = null;
let loading: Promise<void> | null = null;

/** 데이터 적재 전에는 이 간격으로 자주 재시도하고, 적재되면 정상 주기로 전환한다. */
const FAST_RETRY_MS = 30_000;

async function fetchAll(src: SourceConfig): Promise<any[]> {
  const rows: any[] = [];
  let start = 1;
  let total: number | null = null;

  for (let page = 0; page < 200; page++) {
    const end = start + src.pageSize - 1;
    const res = await fetch(src.buildUrl(start, end), {
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) throw new Error(`${src.name} HTTP ${res.status}`);
    const json = await res.json();

    // API 오류(예: 식품안전나라 ERROR-500 "서버오류")를 정상 0건으로 오인하지 않는다.
    if (src.checkError) {
      const err = src.checkError(json);
      if (err) throw new Error(`${src.name} API 오류: ${err}`);
    }

    if (total === null) total = src.extractTotal(json);
    const chunk = src.extractRows(json);
    if (!chunk.length) break;
    rows.push(...chunk);

    if (total !== null && rows.length >= total) break;
    if (chunk.length < src.pageSize) break;
    start = end + 1;
  }
  return rows;
}

function buildSnapshot(all: Array<{ name: string; origin: Origin; rows: any[] }>): Snapshot {
  const records: RecallRecord[] = [];
  for (const { origin, rows } of all) {
    for (const raw of rows) {
      const rec = toRecord(raw, origin);
      if (rec) records.push(rec);
    }
  }

  const byManufacturer = new Map<string, RecallRecord[]>();
  const bySerial = new Map<string, RecallRecord>();
  for (const r of records) {
    bySerial.set(r.id, r);
    if (r.manufacturerNorm) {
      const arr = byManufacturer.get(r.manufacturerNorm);
      arr ? arr.push(r) : byManufacturer.set(r.manufacturerNorm, [r]);
    }
  }

  return {
    records,
    index: buildIndex(records),
    byManufacturer,
    bySerial,
    loadedAt: new Date(),
    sources: all.map((a) => a.name),
  };
}

export async function refresh(): Promise<void> {
  const sources = activeSources();
  if (!sources.length) {
    throw new Error('활성 데이터 소스가 없습니다. .env 의 인증키/URL을 확인하세요.');
  }
  const results = await Promise.allSettled(
    sources.map(async (src) => ({ src, rows: await fetchAll(src) }))
  );

  const ok = results
    .filter((r) => r.status === 'fulfilled')
    .map((r) => (r as any).value as { src: SourceConfig; rows: any[] });
  const failed = results
    .map((r, i) => (r.status === 'rejected' ? `${sources[i].name}: ${(r as any).reason}` : null))
    .filter(Boolean);

  if (!ok.length) {
    if (snapshot) {
      console.warn('[cache] 전체 소스 적재 실패 → 이전 스냅샷 유지:', failed.join(' / '));
      return;
    }
    throw new Error(`전체 소스 적재 실패\n${failed.join('\n')}`);
  }
  if (failed.length) console.warn('[cache] 일부 소스 실패:', failed.join(' / '));

  const next = buildSnapshot(ok.map((o) => ({ name: o.src.name, origin: o.src.origin, rows: o.rows })));
  if (!next.records.length && snapshot && snapshot.records.length) {
    console.warn('[cache] 이번 적재가 0건 → 이전 스냅샷 유지');
    return;
  }
  snapshot = next;
  console.log(
    `[cache] ${snapshot.records.length}건 적재 (${snapshot.sources.join(', ')}) @ ${snapshot.loadedAt.toISOString()}`
  );
}

/**
 * seed 폴백: 저장소에 동봉된 data/seed.json 을 읽어 최소한의 데이터를 확보한다.
 * API가 죽은 상태에서 서버를 새로 배포해도 빈 화면 대신 최근 데이터를 보여준다.
 * 실데이터(refresh)가 성공하면 즉시 덮어써지므로 오래된 정보가 남지 않는다.
 * 파일이 없거나 비어 있으면 조용히 넘어간다.
 */
function loadSeed(): boolean {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(here, '../../data/seed.json'), // dist/mfds -> 프로젝트 루트/data
    resolve(process.cwd(), 'data/seed.json'),
  ];
  for (const p of candidates) {
    try {
      const parsed = JSON.parse(readFileSync(p, 'utf8'));
      const rows: any[] = parsed?.rows ?? [];
      const origin: Origin = parsed?.origin === 'imported' ? 'imported' : 'domestic';
      if (!rows.length) continue;
      snapshot = buildSnapshot([{ name: `seed(${parsed?.capturedAt ?? 'unknown'})`, origin, rows }]);
      console.log(`[cache] seed ${snapshot.records.length}건 로드 (fallback, ${p})`);
      return true;
    } catch {
      /* 다음 후보 */
    }
  }
  return false;
}

/** 도구 호출 경로에서는 절대 외부 API를 부르지 않는다. 메모리만 읽는다. */
export function getSnapshot(): Snapshot {
  if (!snapshot) throw new Error('데이터가 아직 적재되지 않았습니다. 잠시 후 다시 시도하세요.');
  return snapshot;
}

export function isReady(): boolean {
  return snapshot !== null && snapshot.records.length > 0;
}

/**
 * 서버 기동을 막지 않는다. 최초 적재를 1회 시도하되, 실패하면 seed 폴백을 시도하고,
 * 그래도 없으면 빈 상태로 뜬다. 이후 백그라운드로 계속 재시도해 API 복구 시 자동 회복한다.
 */
export async function start(): Promise<void> {
  if (loading) return loading;
  loading = (async () => {
    try {
      await refresh();
    } catch (e: any) {
      console.error('[cache] 최초 적재 실패:', e.message);
      if (loadSeed()) {
        console.log('[cache] seed 폴백으로 기동. 백그라운드에서 실데이터 재시도.');
      } else {
        console.error('[cache] seed 없음 → 데이터 없이 기동, 백그라운드 재시도.');
      }
    }
    scheduleNext();
  })();
  return loading;
}

function scheduleNext(): void {
  const delay = isReady() ? REFRESH_INTERVAL_MS : FAST_RETRY_MS;
  setTimeout(async () => {
    try {
      await refresh();
    } catch (e: any) {
      console.error('[cache] 갱신 실패, 이전 스냅샷 유지:', e.message);
    }
    scheduleNext();
  }, delay);
}

/** health 응답용 상태. 예외를 던지지 않는다. */
export function stats() {
  return {
    ready: isReady(),
    records: snapshot ? snapshot.records.length : 0,
    sources: snapshot ? snapshot.sources : [],
    loadedAt: snapshot ? snapshot.loadedAt.toISOString() : null,
  };
}
