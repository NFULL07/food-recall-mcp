/**
 * 회수등급 정적 매핑.
 *
 * ⚠️ 제출 전 반드시 원문 대조할 것.
 *   - 식품위생법 시행규칙 별표 18 (위해식품등의 회수기준)
 *   - 식약처 「위해식품등의 회수지침」
 *
 * 심사정책: "MCP가 제공하는 데이터의 출처가 명확하지 않은 경우 승인이 반려될 수 있으며,
 *            운영자는 데이터의 출처 및 구성 확인을 위해 증빙 자료를 요청할 수 있습니다."
 * → 아래 문구는 요약이므로, 원문 확인 후 표현을 정확히 맞추고 출처 링크를 남긴다.
 *
 * 이 도구는 외부 API를 호출하지 않는다 → openWorldHint: false
 */

export interface GradeRule {
  grade: string;
  meaning: string;
  action: string;
}

export const GRADE_RULES: GradeRule[] = [
  {
    grade: '1등급',
    meaning:
      '위해요소가 인체 건강에 미치는 영향이 큰 경우. 섭취 시 심각한 건강상 위해가 발생할 수 있다고 판단되는 위반.',
    action: '즉시 섭취·판매 중단, 격리 보관 후 회수 절차 진행. 구입처 또는 제조업체 안내에 따른다.',
  },
  {
    grade: '2등급',
    meaning:
      '위해요소가 인체 건강에 미치는 영향이 중간 정도인 경우. 일시적이거나 회복 가능한 건강상 위해가 우려되는 위반.',
    action: '섭취·판매 중단 후 회수 절차 진행. 구입처 또는 제조업체 안내에 따른다.',
  },
  {
    grade: '3등급',
    meaning:
      '위해요소가 인체 건강에 미치는 영향이 적은 경우. 기준·규격 위반이나 표시 위반 등으로 건강상 위해 우려가 낮은 경우.',
    action: '판매 중단 후 회수 절차 진행. 구입처 또는 제조업체 안내에 따른다.',
  },
];

export const GRADE_SOURCE =
  '출처: 식품위생법 시행규칙 별표 18, 식품의약품안전처 「위해식품등의 회수지침」';

export function lookupGrade(input?: string): GradeRule[] {
  if (!input) return GRADE_RULES;
  const digit = input.match(/[123]/)?.[0];
  if (!digit) return [];
  return GRADE_RULES.filter((r) => r.grade.startsWith(digit));
}
