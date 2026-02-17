# HOBBYTAN AI / AUTOMAGENT OFFICE

Firebase 기반의 가상 AI 오피스입니다.  
Google 로그인 후 CEO(HOBBY)가 지시를 내리면, 에이전트들이 브레인스토밍/협업/실행/보고를 수행합니다.

- Production URL: https://automagent-8d64c.web.app
- Firebase Project: `automagent-8d64c`

---

## 핵심 기능

### 1) 보안 중심 서버 프록시
모든 모델 호출은 Firebase Functions 프록시를 경유합니다.

- `POST /api/llm/text`
- `POST /api/gemini/image`
- `GET /api/health`

브라우저에 API 키를 노출하지 않습니다. 키는 Secret Manager에만 저장합니다.

### 2) 역할 기반 멀티 에이전트 오피스
- 14개 에이전트(CEO 포함), 부서별 좌석/회의실/업무 구역 시각화
- 브레인스토밍 회의실 + 협업 회의실
- 에이전트 순차 발언(앞선 발언 반영)
- 회의 로그/보고서/파일 교환 내역 스레드 단위 추적
- TAN별 액션플랜 탭 + 개별 실행 버튼

### 3) 운영 역할 강화
- **PO-TAN**: 참여자별 업무 배정/우선순위 수립
- **PM-TAN**: 일정/WBS/의존성 관리
- **RESEARCHER-TAN**: 웹 검색 도구 기반 리서치
- **LEGAL-TAN / HR-TAN**: 지속 감시(거버넌스 탭)
- **DEV-TAN**: GitHub 소스와 배포 버전 정합성 점검 의무

### 4) UX-TAN Image Studio
- 모델: `gemini-3-pro-image-preview`
- 옵션: 비율, 해상도(1K/2K/4K), Search Grounding
- 레퍼런스 이미지 최대 14장

### 5) 탭형 워크스페이스
- Left: `Threads / Command / Mission / Settings`
- Right: `Chat / Meetings / Plans / Reports / Logs / Governance`
- 좌/우 패널 토글 지원
- 실업무 없을 때 유휴 이동(ambient motion) 비활성화 가능

---

## 모델 정책 (기본)

- 에이전트 상호 대화: `gpt-5.2`
- 개발 역할(DEV-TAN): `gpt-5.2-codex`
- 이미지 생성: `gemini-3-pro-image-preview`

필요 시 Settings 탭에서 역할별 Provider/Model 변경 가능
(키는 프런트가 아닌 서버 시크릿에서 관리)

---

## 로컬 실행

```bash
npm install
npm --prefix functions install
npm run dev
```

개발 목업 로그인 모드:

```text
http://127.0.0.1:4173/?devMock=1
```

---

## 환경 변수

`.env` 예시는 `.env.example` 참고.

주요 항목:
- `VITE_DEFAULT_OPENAI_MODEL`
- `VITE_DEFAULT_OPENAI_DEV_MODEL`
- `VITE_DEFAULT_ANTHROPIC_MODEL`
- `VITE_DEFAULT_XAI_MODEL`
- `VITE_DEFAULT_GEMINI_TEXT_MODEL`
- `VITE_API_PROXY_BASE` (선택)
- `VITE_FIREBASE_*`

---

## Firebase Secret 설정 (필수)

```bash
firebase functions:secrets:set OPENAI_API_KEY
firebase functions:secrets:set GEMINI_API_KEY
firebase functions:secrets:set ANTHROPIC_API_KEY
firebase functions:secrets:set XAI_API_KEY
```

배포 전 헬스체크:

```bash
curl https://automagent-8d64c.web.app/api/health
```

---

## 수동 배포

```bash
npm run build
npm --prefix functions run build
firebase deploy --only functions,hosting,firestore:rules,storage --project automagent-8d64c
```

---

## GitHub 자동 배포

`.github/workflows/firebase-deploy.yml` 포함.

`main` 브랜치 push 시 자동 배포됩니다.

GitHub Repository Secrets에 아래를 추가하세요.

- `FIREBASE_SERVICE_ACCOUNT_AUTOMAGENT_8D64C`
  - Firebase 서비스 계정 JSON 전체 문자열

자동 배포 대상:
- Functions
- Hosting
- Firestore Rules
- Storage Rules

---

## 파일 프리뷰/다운로드 정책

- 첨부 문서는 인증 가능한 Blob 경로로 우선 접근
- 텍스트 문서는 UTF-8로 강제 디코딩하여 한글 깨짐 최소화
- 보고서/회의록 업로드 시 UTF-8 BOM + `charset=utf-8` 적용

---

## 명령 예시

- 워크플로우 실행: `/run 신규 기능 런칭 전략 수립`
- UX 이미지 생성: `/ux-image 런던 isometric 미니어처 3D 씬`

---

## 트러블슈팅

### `Missing Firebase ID token`
로그인 세션이 없거나 만료된 상태입니다. Google 로그인 후 재시도하세요.

### 첨부 프리뷰가 실패함
권한/URL 이슈일 수 있습니다. 최신 코드에서는 Storage 경로 fallback을 사용합니다.

### Functions 배포 시 기존 함수 삭제 오류
non-interactive 배포에서는 원격에만 남은 함수가 있으면 실패할 수 있습니다.
필요 시 수동 삭제 후 재배포하세요.
