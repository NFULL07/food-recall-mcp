import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getSnapshot } from './mfds/cache.js';
import { matchOne, matchBatch, MatchInput, MAX_BATCH_ITEMS } from './mfds/match.js';
import { text, fmtBatch, fmtMatchOne, fmtRecordBrief, fmtRecordDetail, DISCLAIMER } from './mfds/format.js';
import { normName, normBarcode, parseUserDate } from './mfds/fields.js';
import { lookupGrade, GRADE_SOURCE } from './mfds/grades.js';

const SVC = '식자재 회수점검 (SikjajaeRecallCheck)';
const SAFETY =
  'This tool only compares input against the official MFDS recall list and does not make a safety judgment; final confirmation must follow Food Safety Korea or the retailer/manufacturer notice.';

const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
} as const;

export function registerTools(server: McpServer) {
  // 1. 재고·식단 일괄 대조 — 이 서버의 존재 이유
  server.registerTool(
    'check_inventory_recall_batch',
    {
      title: 'Batch-check an inventory or menu list against food recalls',
      description:
        `Cross-checks a whole inventory list, meal plan, or purchase order (up to ${MAX_BATCH_ITEMS} items) against active food recall and sales-suspension records from the Korea Ministry of Food and Drug Safety, covering both domestic and imported foods. Each item is judged as match / need_more_info / not_affected with the evidence fields used. Intended for school and institutional cafeterias, daycare centers, convenience stores and food distributors performing periodic checks. ${SAFETY} ${SVC}`,
      inputSchema: {
        items: z
          .array(
            z.object({
              product_name: z.string().describe('Product name as written on the package'),
              manufacture_date: z.string().optional().describe('YYYY-MM-DD'),
              expiry_date: z.string().optional().describe('YYYY-MM-DD'),
              barcode: z.string().optional(),
              manufacturer: z.string().optional(),
            })
          )
          .min(1)
          .describe(`Inventory or menu items. Max ${MAX_BATCH_ITEMS}; extras are ignored.`),
      },
      annotations: { title: 'Batch recall check for inventory', openWorldHint: true, ...READ_ONLY },
    },
    async ({ items }) => {
      const { index } = getSnapshot();
      const inputs: MatchInput[] = items.map((i) => ({
        productName: i.product_name,
        manufactureDate: i.manufacture_date,
        expiryDate: i.expiry_date,
        barcode: i.barcode,
        manufacturer: i.manufacturer,
      }));
      const { results, truncated } = matchBatch(inputs, index);
      return text(fmtBatch(results, truncated));
    }
  );

  // 2. 기간·분류별 최근 회수 목록
  server.registerTool(
    'list_recent_food_recalls',
    {
      title: 'List recent food recalls by period and category',
      description:
        'Lists recent food recall and sales-suspension records from the Korea MFDS, filtered by registration period and food category, covering domestic and imported foods. Useful for weekly safety checks at cafeterias and retailers. Returns a compact summary; use get_recall_detail for a single record. ' +
        SAFETY +
        ' ' +
        SVC,
      inputSchema: {
        days: z.number().int().min(1).max(365).default(30).describe('Look back this many days'),
        category: z.string().optional().describe('Food category keyword, e.g. 과자류, 유가공품'),
        limit: z.number().int().min(1).max(30).default(10),
      },
      annotations: { title: 'Recent recalls', openWorldHint: true, ...READ_ONLY },
    },
    async ({ days, category, limit }) => {
      const { records } = getSnapshot();
      const cutoff = Date.now() - days * 86400_000;
      const catNorm = normName(category);

      let rows = records.filter((r) => {
        if (catNorm && !normName(r.category).includes(catNorm)) return false;
        const ymd = parseUserDate(r.registeredAt);
        if (ymd === null) return true; // 등록일 없으면 기간 필터에서 제외하지 않는다
        const y = Math.floor(ymd / 10000);
        const m = Math.floor((ymd % 10000) / 100);
        const d = ymd % 100;
        return Date.UTC(y, m - 1, d) >= cutoff;
      });

      rows = rows.slice(0, limit);
      if (!rows.length) {
        return text(
          `## 최근 ${days}일 회수·판매중지 내역\n\n${category ? `분류 \`${category}\` 기준 ` : ''}해당 건이 없습니다.${DISCLAIMER}`
        );
      }
      const head = `## 최근 ${days}일 회수·판매중지 ${rows.length}건${category ? ` (분류: ${category})` : ''}\n`;
      return text(head + '\n' + rows.map(fmtRecordBrief).join('\n') + DISCLAIMER);
    }
  );

  // 3. 제조업체별 회수 이력 집계
  server.registerTool(
    'check_manufacturer_recall_history',
    {
      title: 'Aggregate recall history for a manufacturer',
      description:
        'Aggregates the number of food recall and sales-suspension records for a given manufacturer, with the most recent cases. Web search returns individual recall notices; this tool returns a per-manufacturer count that is not available from the source API. Intended for pre-order supplier screening by retailers and distributors. ' +
        SAFETY +
        ' ' +
        SVC,
      inputSchema: {
        manufacturer: z.string().describe('Manufacturer name'),
        limit: z.number().int().min(1).max(20).default(5),
      },
      annotations: { title: 'Manufacturer recall history', openWorldHint: true, ...READ_ONLY },
    },
    async ({ manufacturer, limit }) => {
      const { byManufacturer } = getSnapshot();
      const rows = byManufacturer.get(normName(manufacturer)) ?? [];
      if (!rows.length) {
        return text(
          `## ${manufacturer}\n\n회수·판매중지 이력이 확인되지 않았습니다.\n\n> 제조업체명 표기가 회수 목록과 다를 수 있습니다.${DISCLAIMER}`
        );
      }
      const grades = rows.reduce<Record<string, number>>((a, r) => {
        const g = r.grade ?? '미상';
        a[g] = (a[g] ?? 0) + 1;
        return a;
      }, {});
      const gradeLine = Object.entries(grades)
        .map(([g, n]) => `${g} ${n}건`)
        .join(' · ');
      const head = `## ${manufacturer} 회수 이력\n\n**총 ${rows.length}건** — ${gradeLine}\n\n### 최근 ${Math.min(limit, rows.length)}건\n`;
      return text(head + rows.slice(0, limit).map(fmtRecordBrief).join('\n') + DISCLAIMER);
    }
  );

  // 4. 단일 제품 로트 대조
  server.registerTool(
    'check_product_recall_match',
    {
      title: 'Check one product against the recall list by lot',
      description:
        'Checks whether a single food product at hand matches an active recall record from the Korea MFDS, comparing product name, manufacture date, expiry date, barcode and manufacturer. A recall usually applies only to a specific manufacturing lot range, not to every unit sharing the product name, so this tool returns match / need_more_info / not_affected together with the evidence fields used. ' +
        SAFETY +
        ' ' +
        SVC,
      inputSchema: {
        product_name: z.string(),
        manufacture_date: z.string().optional().describe('YYYY-MM-DD'),
        expiry_date: z.string().optional().describe('YYYY-MM-DD'),
        barcode: z.string().optional(),
        manufacturer: z.string().optional(),
      },
      annotations: { title: 'Single product recall check', openWorldHint: true, ...READ_ONLY },
    },
    async (a) => {
      const { index } = getSnapshot();
      const m = matchOne(
        {
          productName: a.product_name,
          manufactureDate: a.manufacture_date,
          expiryDate: a.expiry_date,
          barcode: a.barcode,
          manufacturer: a.manufacturer,
        },
        index
      );
      return text(fmtMatchOne(m));
    }
  );

  // 5. 바코드 역인덱스
  server.registerTool(
    'check_recall_by_barcode',
    {
      title: 'Look up recalls by barcode',
      description:
        'Looks up food recall and sales-suspension records by barcode number using a reverse index over the Korea MFDS recall data. Barcode lookup is not possible through general web search. ' +
        SAFETY +
        ' ' +
        SVC,
      inputSchema: { barcode: z.string().describe('Barcode digits; separators are ignored') },
      annotations: { title: 'Barcode recall lookup', openWorldHint: true, ...READ_ONLY },
    },
    async ({ barcode }) => {
      const { index } = getSnapshot();
      const rows = index.byBarcode.get(normBarcode(barcode)) ?? [];
      if (!rows.length) {
        return text(
          `## 바코드 ${barcode}\n\n회수·판매중지 목록에 일치하는 바코드가 없습니다.\n\n> 회수 데이터에 바코드가 등록되지 않은 건이 있을 수 있습니다. 제품명으로도 확인해 보세요.${DISCLAIMER}`
        );
      }
      return text(`## 바코드 ${barcode} — ${rows.length}건\n\n` + rows.map(fmtRecordBrief).join('\n') + DISCLAIMER);
    }
  );

  // 6. 상세
  server.registerTool(
    'get_recall_detail',
    {
      title: 'Get full detail of one recall record',
      description:
        'Returns the full detail of a single food recall record by its record ID, including recall reason, recall grade, target lot range, recall method and the product photo when available. Use the record ID returned by other tools. ' +
        SAFETY +
        ' ' +
        SVC,
      inputSchema: { record_id: z.string().describe('Record ID, e.g. D-1001 or I-2003') },
      annotations: { title: 'Recall record detail', openWorldHint: true, ...READ_ONLY },
    },
    async ({ record_id }) => {
      const { bySerial } = getSnapshot();
      const r = bySerial.get(record_id);
      if (!r) return text(`레코드 \`${record_id}\` 를 찾을 수 없습니다.${DISCLAIMER}`);
      return text(fmtRecordDetail(r));
    }
  );

  // 7. 등급 규칙 (정적) — 외부 호출 없음
  server.registerTool(
    'get_recall_grade_rule',
    {
      title: 'Look up the statutory meaning of a recall grade',
      description:
        'Returns the statutory meaning and prescribed action for Korean food recall grades 1 to 3, from a static table based on the Enforcement Rule of the Food Sanitation Act (Annex 18) and the MFDS recall guideline. This tool does not call any external service. ' +
        SVC,
      inputSchema: { grade: z.string().optional().describe('1, 2, 3, or omit for all') },
      annotations: {
        title: 'Recall grade rule',
        openWorldHint: false, // 정적 테이블. 외부 세계를 조회하지 않는다
        ...READ_ONLY,
      },
    },
    async ({ grade }) => {
      const rules = lookupGrade(grade);
      if (!rules.length) return text(`\`${grade}\` 는 유효한 회수등급이 아닙니다. 1, 2, 3 중 하나입니다.`);
      const body = rules
        .map((r) => `### ${r.grade}\n\n**의미** ${r.meaning}\n\n**조치** ${r.action}`)
        .join('\n\n');
      return text(`## 회수등급 기준\n\n${body}\n\n> ${GRADE_SOURCE}`);
    }
  );
}
