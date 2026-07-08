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

  if (!ok.length) throw new Error(`전체 소스 적재 실패\n${failed.join('\n')}`);
  if (failed.length) console.warn('[cache] 일부 소스 실패:', failed.join(' / '));

  snapshot = buildSnapshot(ok);
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
  return snapshot !== null;
}

export async function start(): Promise<void> {
  if (loading) return loading;
  loading = (async () => {
    await refresh();
    setInterval(() => {
      refresh().catch((e) => console.error('[cache] 갱신 실패, 이전 스냅샷 유지:', e.message));
    }, REFRESH_INTERVAL_MS);
  })();
  return loading;
}
