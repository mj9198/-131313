# 알바체크 AI

청소년 아르바이트 공고의 근로조건을 확인하는 교육용 웹앱입니다.

## 로컬 실행

1. Node.js 20 이상을 설치합니다.
2. 저장소를 내려받고 프로젝트 폴더에서 터미널을 엽니다.
3. `.env.example`을 복사해 `.env` 파일을 만듭니다.
4. `.env`의 DATA_GO_KR_SERVICE_KEY와 KOSIS_API_KEY에 본인이 발급받은 인증키를 입력합니다.
5. `npm start`를 실행하고 브라우저에서 `http://localhost:3000`을 엽니다.

인증키를 HTML, GitHub 코드, 화면 캡처, 학교 제출 문서에 넣지 마세요. 실제 인증키가 담긴 `.env` 파일은 Git에 올리지 않습니다.

## 배포

정적 HTML 호스팅만으로는 API 프록시를 실행할 수 없습니다. Node.js 서버를 실행할 수 있는 호스팅 환경에 배포해야 합니다. 배포 서비스의 환경변수 설정에 다음 두 항목을 등록하세요.

- DATA_GO_KR_SERVICE_KEY
- KOSIS_API_KEY

시작 명령은 `npm start`입니다. GitHub Pages는 Node.js 서버를 실행하지 않으므로 이 프로젝트의 API 기능을 단독으로 제공할 수 없습니다.

## API 경로

- GET /api/health: 서버 및 인증키 설정 여부(키 값 자체는 반환하지 않음)
- GET /api/youth-survey?year=2017&targetSn=2&itemSn=204: 청소년종합실태조사 마이크로데이터
- GET /api/kosis-statistics?orgId=...&tblId=...&itmId=...&objL1=...&startPrdDe=2020&endPrdDe=2025: KOSIS 연도별 통계

청소년 API의 조사연도·대상·항목 번호는 조회 조건입니다. 실제 근로 관련 항목인지 응답의 항목명과 단위를 확인하세요. KOSIS ID도 공식 통계표에서 확인한 값을 사용하세요.

## 공식 문서

- https://www.data.go.kr/data/15078212/openapi.do
- https://kosis.kr/openapi/devGuide/devGuide_0201List.do
