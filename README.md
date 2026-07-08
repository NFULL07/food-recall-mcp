# 식자재회수점검 (foodRecall)

식약처 회수·판매중지 데이터를 기간·식품분류·제조업체 단위로 **집계**하고,
취급 중인 식자재의 회수 해당 여부를 **로트 단위로 대조**하는 MCP 서버.

- MCP 이름: 식자재회수점검
- 식별자(prefix): `foodRecall`
- 전송: Streamable HTTP, **Stateless** (`POST /mcp`)
- 도구 7개, 생성형 0개

## 왜 MCP가 필요한가 (심사 대응)

회수는 제품명 전체가 아니라 **특정 제조일자·유통기한 범위의 로트만** 대상이다.
공개 API는 목록만 준다. 판정은 안 한다. LLM은 최신 회수 목록을 모른다.
`check_inventory_recall_batch` 는 목록 30개를 한 번에 대조한다. 웹 검색으로는 30번 검색해야 한다.

## 100ms 대응

PlayMCP 요구: 툴 응답속도 평균 100ms, p99 3,000ms.
→ 기동 시 전량 메모리 적재, 주기 갱신. **도구 호출 경로에 외부 API 호출 없음.**

## 시작

    cp .env.example .env      # 인증키 입력
    npm i
    npm run test:match        # 판정 로직 검증 (네트워크 불필요)
    npm run probe             # 스키마 탐색 (인증키 없이도 샘플 확인 가능)
    npm run build && npm start

    curl localhost:8080/health

## 제출 전 체크리스트

- [ ] `npm run probe` → 실제 필드명을 `src/mfds/fields.ts` CANDIDATES 맨 앞에 추가
- [ ] 바코드 채움률 확인 → 낮으면 도구 5번을 보조로 강등
- [ ] `src/mfds/grades.ts` 문구를 시행규칙 별표18 원문과 대조
- [ ] MCP Inspector 검증: `npx @modelcontextprotocol/inspector`
- [ ] 도구 7개 전부 실제 호출, 응답 24k 미만 확인
- [ ] 카카오 클라우드(PlayMCP in KC) 배포 → Endpoint URL
- [ ] PlayMCP 임시 등록 → "정보 불러오기" 성공
- [ ] 도구함 추가 → AI 채팅 테스트
- [ ] **심사 요청** (요청 후 도구 변경 시 재심사)

## 데이터 출처

- 식품안전나라 회수·판매중지 (I0490)
- 공공데이터포털 15074318 식품의 회수 및 판매중지 정보
- 공공데이터포털 15095378 수입식품 회수판매중지 제품 정보

심사정책상 출처 증빙 요청 가능 → 활용신청 화면 캡처와 승인번호 보관.
