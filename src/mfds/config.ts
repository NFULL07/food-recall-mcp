import { Origin } from './types.js';

export interface SourceConfig {
  name: string;
  origin: Origin;
  /** 페이지 URL을 만드는 함수. start/end는 1-based inclusive row index */
  buildUrl: (start: number, end: number) => string;
  /** 응답 JSON에서 레코드 배열을 꺼내는 함수 */
  extractRows: (json: any) => any[];
  /** 응답 JSON에서 전체 건수를 꺼내는 함수 (없으면 null) */
  extractTotal: (json: any) => number | null;
  pageSize: number;
}

const KEY = process.env.DATA_GO_KR_KEY ?? '';
const FOODSAFETY_KEY = process.env.FOODSAFETYKOREA_API_KEY ?? KEY;

/**
 * 식품안전나라 회수·판매중지 (서비스 I0490)
 * 문서: https://www.foodsafetykorea.go.kr/api/openApiInfo.do (svc_no=I0490)
 * 샘플: https://openapi.foodsafetykorea.go.kr/api/sample/I0490/json/1/5
 */
export const FOODSAFETY_I0490: SourceConfig = {
  name: 'foodsafetykorea:I0490',
  origin: 'domestic',
  pageSize: 1000,
  buildUrl: (s, e) =>
    `https://openapi.foodsafetykorea.go.kr/api/${FOODSAFETY_KEY}/I0490/json/${s}/${e}`,
  extractRows: (j) => j?.I0490?.row ?? [],
  extractTotal: (j) => {
    const n = Number(j?.I0490?.total_count);
    return Number.isFinite(n) ? n : null;
  },
};

/**
 * 공공데이터포털 엔드포인트는 활용신청 승인 후 상세 페이지에서 확인해야 한다.
 * probe 스크립트로 확인한 값을 .env 에 넣는다. 추측해서 하드코딩하지 않는다.
 *
 *   MFDS_DOMESTIC_URL=https://apis.data.go.kr/.../getXxxList
 *   MFDS_IMPORTED_URL=https://apis.data.go.kr/.../getYyyList
 */
function dataGoKrSource(
  name: string,
  origin: Origin,
  baseUrl: string | undefined
): SourceConfig | null {
  if (!baseUrl) return null;
  return {
    name,
    origin,
    pageSize: 100,
    buildUrl: (s, e) => {
      const pageNo = Math.floor((s - 1) / (e - s + 1)) + 1;
      const numOfRows = e - s + 1;
      const u = new URL(baseUrl);
      u.searchParams.set('serviceKey', KEY);
      u.searchParams.set('pageNo', String(pageNo));
      u.searchParams.set('numOfRows', String(numOfRows));
      u.searchParams.set('type', 'json');
      return u.toString();
    },
    extractRows: (j) => {
      const items = j?.response?.body?.items;
      if (Array.isArray(items)) return items;
      if (Array.isArray(items?.item)) return items.item;
      if (items?.item) return [items.item];
      if (Array.isArray(j?.body?.items)) return j.body.items;
      return [];
    },
    extractTotal: (j) => {
      const n = Number(j?.response?.body?.totalCount ?? j?.body?.totalCount);
      return Number.isFinite(n) ? n : null;
    },
  };
}

export function activeSources(): SourceConfig[] {
  const out: SourceConfig[] = [];
  if (FOODSAFETY_KEY) out.push(FOODSAFETY_I0490);
  const dom = dataGoKrSource('data.go.kr:15074318', 'domestic', process.env.MFDS_DOMESTIC_URL);
  const imp = dataGoKrSource('data.go.kr:15095378', 'imported', process.env.MFDS_IMPORTED_URL);
  if (dom) out.push(dom);
  if (imp) out.push(imp);
  return out;
}

export const REFRESH_INTERVAL_MS =
  Number(process.env.REFRESH_INTERVAL_MIN ?? 180) * 60 * 1000;
export const PORT = Number(process.env.PORT ?? 8080);
export const MAX_RESPONSE_CHARS = 20000; // 24k 제한에 대한 안전 마진
