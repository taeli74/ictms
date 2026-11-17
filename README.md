# Easy ICT Master (ICTMS) — 실서비스 배포

아티팩트로 만든 Easy ICT Master를 **Supabase(백엔드) + Vercel(프론트)** 로 운영하기 위한 프로젝트입니다.

## 구조

```
artifact/source.html          아티팩트 원본 HTML (수정은 여기서)
scripts/split-artifact.mjs    원본 → 배포용 파일로 분리 + Supabase용 패치 (npm run split)
index.html                    (생성됨) 마크업
public/app.js                 (생성됨) 화면 코드 — 직접 고치지 말 것
public/app.css, public/fonts  (생성됨) 스타일, Paperlogy 폰트
src/main.js                   Supabase 어댑터: window.claude(db/assets/downloads/user)를 Supabase로 구현
supabase/migrations/0001_init.sql   테이블 · 권한(RLS) · 사진 버킷
supabase/functions/admin-users      계정 발급/수정/삭제 (통합관리자 전용)
scripts/create-admin.mjs      첫 관리자 계정 생성
scripts/import-backup.mjs     기존 데이터 이전
```

화면 코드는 아티팩트 그대로이고, 아래만 바뀌었습니다 (`split-artifact.mjs`의 패치 목록):
- 로그인 → Supabase Auth (새로고침해도 로그인 유지, 로그아웃 시 세션 종료)
- 계정 저장/삭제 → Edge Function (비밀번호 해시를 더 이상 DB 문서에 두지 않음)
- 코드에 박혀 있던 기본 계정(admin/12345 등) 제거, 비밀번호 최소 8자
- 사진 → 비공개 Storage + 1시간짜리 서명 URL

권한 범위는 앱의 `applyScope()`와 같은 규칙을 **DB가 강제**합니다 (admin 전체 / 업체는 자기 업체 사이트 / 고객사는 자기 사이트).

---

## 1. Supabase 설정 (한 번)

1. https://supabase.com → New project — 리전 **Northeast Asia (Seoul)**.
   실서비스는 Pro 플랜 권장 (무료 플랜은 7일 미사용 시 일시정지, 자동 백업 없음).
2. **SQL Editor**에 `supabase/migrations/0001_init.sql` 전체를 붙여넣고 Run.
3. **Authentication → Sign In / Providers → Email**
   - *Allow new users to sign up*: **끄기** (계정은 관리자만 발급)
   - *Confirm email*: **끄기** (아이디@ictms.local 형태의 가짜 이메일을 씀)
   - *Minimum password length*: **8**
4. **Project Settings → API**에서 `Project URL`, `anon` 키, `service_role` 키를 확인.
5. Edge Function 배포 (Supabase CLI 설치 없이 npx로):
   ```bash
   npx supabase login
   ```
   ```bash
   npx supabase functions deploy admin-users --project-ref <프로젝트 ref>
   ```

## 2. 로컬 실행

```bash
cp .env.example .env.local
```
```bash
cp .env.server.example .env.server
```
두 파일에 URL과 키를 채운 뒤:
```bash
npm install
```
```bash
npm run create-admin -- admin <8자 이상 비밀번호>
```
```bash
npm run dev
```
http://localhost:5173 에서 위 관리자 계정으로 로그인 → 설정에서 업체·고객사 계정을 발급합니다.

## 3. 기존 데이터 이전

```bash
npm run import-backup -- backups/easy-ict-master.json --dry-run
```
```bash
npm run import-backup -- backups/easy-ict-master.json --photos-dir backups/photos --temp-password <임시비밀번호>
```
- 백업 JSON은 앱의 "백업 내려받기" 파일 또는 아티팩트 DB에서 뽑은 파일.
- 기존 계정은 비밀번호를 옮길 수 없어서, `--temp-password`로 임시 비밀번호를 주고 사용자가 첫 로그인 후 바꾸게 합니다.

## 4. Vercel 배포

1. 이 폴더를 GitHub 저장소로 올립니다 (`.env.*`는 `.gitignore`로 제외됨).
2. https://vercel.com → Add New Project → 저장소 선택 (Framework: Vite, 설정은 `vercel.json`).
3. Environment Variables에 `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_LOGIN_DOMAIN` 입력 → Deploy.
4. 도메인 연결: Vercel → Settings → Domains.
5. Supabase → Authentication → URL Configuration의 Site URL에 배포 주소를 넣습니다.

> `service_role` 키는 절대 Vercel 환경변수(VITE_*)나 코드에 넣지 마세요. 서버 스크립트(.env.server)와 Edge Function에서만 씁니다.

## 아티팩트를 고친 뒤 반영하기

1. 아티팩트 HTML을 `artifact/source.html`에 덮어씁니다.
2. `npm run split` — 패치가 맞지 않으면 어느 패치인지 알려 주고 멈춥니다.
3. 커밋·푸시하면 Vercel이 자동 배포합니다.

## 알려진 제한 / 다음 단계

- 사진은 로그인한 사용자라면 사진 ID를 알 때 열람 가능합니다 (ID는 추측 불가능한 UUID). 사이트 단위로 막으려면 업로드 경로에 siteId를 넣도록 화면 코드를 고쳐야 합니다.
- `people`(인력)은 업체 계정이 모든 업체 인력을 볼 수 있습니다 (현재 앱 동작과 동일). 개인정보 범위를 줄이려면 `doc_visible()`의 people 규칙을 조정하세요.
- 데이터가 수만 건을 넘으면 컬렉션 전체를 한 번에 불러오는 방식(아티팩트와 동일)이 느려질 수 있습니다. 그때 테이블 정규화·페이지 단위 조회로 옮깁니다.
- 개인정보처리방침 페이지, 접속 기록 보관은 별도로 준비해야 합니다.
