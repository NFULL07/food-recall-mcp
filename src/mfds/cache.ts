import { activeSources, REFRESH_INTERVAL_MS, SourceConfig } from './config.js';
import { RecallRecord, toRecord } from './types.js';
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

function buildSnapshot(all: Array<{ src: SourceConfig; rows: any[] }>): Snapshot {
  const records: RecallRecord[] = [];
  for (const { src, rows } of all) {
    for (const raw of rows) {
      const rec = toRecord(raw, src.origin);
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
    sources: all.map((a) => a.src.name),
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

  const ok = results.filter((r) => r.status === 'fulfilled').map((r) => (r as any).value);
  const failed = results
    .map((r, i) => (r.status === 'rejected' ? `${sources[i].name}: ${(r as any).reason}` : null))
    .filter(Boolean);

  if (!ok.length) {
    // 전체 소스 실패. 이전 정상 스냅샷이 있으면 그대로 유지하고(빈 데이터로 덮지 않음),
    // 최초 기동이라 스냅샷이 없을 때만 오류를 던진다.
    if (snapshot) {
      console.warn('[cache] 전체 소스 적재 실패 → 이전 스냅샷 유지:', failed.join(' / '));
      return;
    }
    throw new Error(`전체 소스 적재 실패\n${failed.join('\n')}`);
  }
  if (failed.length) console.warn('[cache] 일부 소스 실패:', failed.join(' / '));

  const next = buildSnapshot(ok);
  // 방어: 이전에 데이터가 있었는데 이번에 0건이면(순간 장애 가능성) 이전 것을 유지한다.
  if (!next.records.length && snapshot && snapshot.records.length) {
    console.warn('[cache] 이번 적재가 0건 → 이전 스냅샷 유지');
    return;
  }
  snapshot = next;
  console.log(
    `[cache] ${snapshot.records.length}건 적재 (${snapshot.sources.join(', ')}) @ ${snapshot.loadedAt.toISOString()}`
  );
}

/** 도구 호출 경로에서는 절대 외부 API를 부르지 않는다. 메모리만 읽는다. */
export function getSnapshot(): Snapshot {
  if (!snapshot) throw new Error('데이터가 아직 적재되지 않았습니다. 잠시 후 다시 시도하세요.');
  return snapshot;
}

export function isReady(): boolean {
  return snapshot !== null && snapshot.records.length > 0;
}

export async function start(): Promise<void> {
  if (loading) return loading;
  loading = (async () => {
    // 최초 적재: 정부 API 순간 장애에 대비해 몇 차례 재시도한다.
    const MAX_TRIES = 6;
    for (let i = 1; ; i++) {
      try {
        await refresh();
        break;
      } catch (e: any) {
        if (i >= MAX_TRIES) throw e;
        console.error(
          `[cache] 최초 적재 실패 (시도 ${i}/${MAX_TRIES}), 10초 후 재시도: ${e.message}`
        );
        await new Promise((r) => setTimeout(r, 10000));
      }
    }
    setInterval(() => {
      refresh().catch((e) => console.error('[cache] 갱신 실패, 이전 스냅샷 유지:', e.message));
    }, REFRESH_INTERVAL_MS);
  })();
  return loading;
}
