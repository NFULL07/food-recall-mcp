import { MAX_RESPONSE_CHARS } from './config.js';
import { RecallRecord } from './types.js';
import { MatchResult, Verdict } from './match.js';

export const DISCLAIMER =
  '\n\n> 이 도구는 식약처 회수·판매중지 목록과 입력값의 일치 여부만 확인합니다. 최종 확인은 식품안전나라 또는 구입처·제조업체 안내를 따르십시오.';

/** PlayMCP: Response 24k 초과 시 에러 처리 → 반려 사유. 안전 마진을 두고 절단한다. */
export function guard(md: string): string {
  if (md.length <= MAX_RESPONSE_CHARS) return md;
  return (
    md.slice(0, MAX_RESPONSE_CHARS - 200) +
    '\n\n…(응답 크기 제한으로 이하 생략. 조회 범위를 좁혀 다시 호출하세요.)'
  );
}

export function text(md: string) {
  return { content: [{ type: 'text' as const, text: guard(md) }] };
}

const VERDICT_LABEL: Record<Verdict, string> = {
  match: '⚠️ 회수 대상에 해당',
  need_more_info: '❓ 추가 정보 필요',
  not_affected: '✅ 미해당',
};

const MISSING_LABEL: Record<string, string> = {
  product_name: '제품명',
  manufacture_date: '제조일자',
  expiry_date: '유통기한',
  barcode: '바코드',
  manufacturer: '제조업체명',
};

export function fmtRecordBrief(r: RecallRecord): string {
  const bits = [`**${r.productName}**`];
  if (r.manufacturer) bits.push(r.manufacturer);
  if (r.grade) bits.push(`${r.grade}`);
  if (r.reason) bits.push(r.reason);
  bits.push(r.origin === 'imported' ? '수입' : '국내');
  return `- ${bits.join(' · ')} \`${r.id}\``;
}

export function fmtRecordDetail(r: RecallRecord): string {
  const lines: string[] = [`## ${r.productName}`, ''];
  const row = (k: string, v?: string) => (v ? lines.push(`**${k}** ${v}`) : void 0);
  row('구분', r.origin === 'imported' ? '수입식품' : '국내식품');
  row('제조업체', r.manufacturer);
  row('회수등급', r.grade);
  row('회수사유', r.reason);
  row('식품분류', r.category);
  row('제조일자', r.manufactureRange?.raw);
  row('유통기한', r.expiryRange?.raw);
  row('포장단위', r.packUnit);
  row('바코드', r.barcode);
  row('회수방법', r.method);
  row('등록일', r.registeredAt);
  if (r.photoUrl) lines.push('', `![${r.productName}](${r.photoUrl})`);
  return lines.join('\n') + DISCLAIMER;
}

export function fmtMatchOne(m: MatchResult): string {
  const lines: string[] = [`## ${VERDICT_LABEL[m.verdict]}`, ''];
  lines.push(`**입력 제품** ${m.input.productName}`);
  if (m.input.manufacturer) lines.push(`**입력 제조업체** ${m.input.manufacturer}`);
  if (m.input.manufactureDate) lines.push(`**입력 제조일자** ${m.input.manufactureDate}`);
  if (m.input.expiryDate) lines.push(`**입력 유통기한** ${m.input.expiryDate}`);
  if (m.input.barcode) lines.push(`**입력 바코드** ${m.input.barcode}`);

  if (m.record && m.verdict !== 'not_affected') {
    lines.push('', '### 대조된 회수 레코드');
    if (m.record.grade) lines.push(`**회수등급** ${m.record.grade}`);
    if (m.record.reason) lines.push(`**회수사유** ${m.record.reason}`);
    if (m.record.manufactureRange) lines.push(`**대상 제조일자** ${m.record.manufactureRange.raw}`);
    if (m.record.expiryRange) lines.push(`**대상 유통기한** ${m.record.expiryRange.raw}`);
    lines.push(`**레코드 ID** \`${m.record.id}\``);
    if (m.record.photoUrl) lines.push('', `![${m.record.productName}](${m.record.photoUrl})`);
  }

  if (m.evidence.length) {
    lines.push('', '### 판정 근거');
    m.evidence.forEach((e) => lines.push(`- ${e}`));
  }
  if (m.missing.length) {
    lines.push('', '### 확정에 필요한 추가 입력');
    m.missing.forEach((k) => lines.push(`- ${MISSING_LABEL[k] ?? k}`));
  }
  return lines.join('\n') + DISCLAIMER;
}

export function fmtBatch(results: MatchResult[], truncated: boolean): string {
  const g = (v: Verdict) => results.filter((r) => r.verdict === v);
  const match = g('match');
  const need = g('need_more_info');
  const clear = g('not_affected');

  const lines: string[] = ['## 재고·식단 회수 대조 결과', ''];
  lines.push(
    `총 ${results.length}개 품목 · 해당 **${match.length}** · 추가확인 **${need.length}** · 미해당 ${clear.length}`
  );
  if (truncated) lines.push('', '> 입력 품목이 30개를 초과하여 앞의 30개만 대조했습니다.');

  if (match.length) {
    lines.push('', '### ⚠️ 회수 대상에 해당');
    for (const m of match) {
      lines.push(`- **${m.input.productName}**`);
      if (m.record?.grade) lines.push(`  - 회수등급: ${m.record.grade}`);
      if (m.record?.reason) lines.push(`  - 사유: ${m.record.reason}`);
      if (m.evidence.length) lines.push(`  - 근거: ${m.evidence[m.evidence.length - 1]}`);
    }
  }
  if (need.length) {
    lines.push('', '### ❓ 추가 확인 필요');
    for (const m of need) {
      const want = m.missing.map((k) => MISSING_LABEL[k] ?? k).join(', ');
      lines.push(`- **${m.input.productName}** — ${want} 입력 필요`);
    }
  }
  if (clear.length) {
    lines.push('', '### ✅ 미해당');
    lines.push(clear.map((m) => m.input.productName).join(', '));
  }
  return lines.join('\n') + DISCLAIMER;
}
