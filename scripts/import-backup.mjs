// 기존 데이터를 Supabase로 옮기기
//   npm run import-backup -- <백업.json> [--photos-dir 폴더] [--temp-password 임시비밀번호] [--dry-run]
//
// 백업 JSON 형식: { app:'easy-ict-master', db:{ 컬렉션:{ id:데이터 } }, photos?:{ id:'data:image/...' } }
//  - 앱의 "백업 내려받기" 파일, 아티팩트 DB에서 뽑은 파일 모두 이 형식입니다.
//  - --photos-dir: 사진 파일이 <사진id>.<확장자> 로 들어 있는 폴더 (아티팩트 사진을 따로 받은 경우)
//  - accounts 컬렉션은 비밀번호 방식이 달라 그대로 옮길 수 없습니다.
//    --temp-password 를 주면 모든 계정을 그 임시 비밀번호로 만들고, 없으면 목록만 출력합니다.
import { readFileSync, readdirSync } from 'node:fs';
import { join, extname, basename } from 'node:path';
import { createClient } from '@supabase/supabase-js';

const args = process.argv.slice(2);
const VALUED = ['--photos-dir', '--temp-password'];
const file = args.find((a, i) => !a.startsWith('--') && !VALUED.includes(args[i - 1]));
const opt = k => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const dry = args.includes('--dry-run');
if (!file) { console.error('사용법: npm run import-backup -- <백업.json> [--photos-dir 폴더] [--temp-password 비밀번호] [--dry-run]'); process.exit(1); }

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, LOGIN_DOMAIN = 'ictms.local' } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) { console.error('.env.server 를 먼저 채우세요.'); process.exit(1); }
const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const bk = JSON.parse(readFileSync(file, 'utf8'));
if (!bk || bk.app !== 'easy-ict-master' || !bk.db) { console.error('Easy ICT Master 백업 파일이 아닙니다.'); process.exit(1); }

const COLS = ['sites', 'inspections', 'issues', 'companies', 'people', 'clients', 'memos', 'locations', 'cables', 'cabchecks'];

// 1) 업무 데이터
for (const col of COLS) {
  const rows = Object.entries(bk.db[col] || {}).map(([id, data]) => ({ collection: col, id, data }));
  if (!rows.length) continue;
  if (dry) { console.log(`[dry] ${col}: ${rows.length}건`); continue; }
  for (let i = 0; i < rows.length; i += 300) {
    const { error } = await sb.from('docs').upsert(rows.slice(i, i + 300));
    if (error) { console.error(`${col} 실패:`, error.message); process.exit(1); }
  }
  console.log(`${col}: ${rows.length}건`);
}

// 2) 사진
const mime = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif' };
const photos = [];
for (const [id, url] of Object.entries(bk.photos || {})) {
  const m = /^data:(image\/[a-z+]+);base64,(.*)$/.exec(url || '');
  if (m) photos.push({ id, type: m[1], buf: Buffer.from(m[2], 'base64') });
}
const dir = opt('--photos-dir');
if (dir) for (const f of readdirSync(dir)) {
  const ext = extname(f).toLowerCase();
  if (mime[ext]) photos.push({ id: basename(f, extname(f)), type: mime[ext], buf: readFileSync(join(dir, f)) });
}
let up = 0;
for (const p of photos) {
  if (dry) continue;
  const { error } = await sb.storage.from('photos').upload(p.id, p.buf, { contentType: p.type, upsert: true });
  if (error) console.error(`사진 ${p.id} 실패:`, error.message); else up++;
}
console.log(dry ? `[dry] 사진 ${photos.length}장` : `사진: ${up}/${photos.length}장`);

// 3) 계정
const accts = Object.entries(bk.db.accounts || {});
if (accts.length) {
  const temp = opt('--temp-password');
  console.log(`\n계정 ${accts.length}개 ${temp ? '— 임시 비밀번호로 생성' : '— 통합관리자 화면에서 다시 발급하세요'}:`);
  for (const [loginId, a] of accts) {
    const line = `  ${loginId}  (${a.role}${a.refType ? ', ' + a.refType + ':' + a.refId : ''})`;
    if (!temp || dry) { console.log(line); continue; }
    if (temp.length < 8) { console.error('임시 비밀번호는 8자 이상'); process.exit(1); }
    const { data: ex } = await sb.from('profiles').select('id').eq('login_id', loginId).maybeSingle();
    if (ex) { console.log(line + ' — 이미 있음, 건너뜀'); continue; }
    const { data, error } = await sb.auth.admin.createUser({ email: `${loginId}@${LOGIN_DOMAIN}`, password: temp, email_confirm: true });
    if (error) { console.log(line + ' — 실패: ' + error.message); continue; }
    const { error: pe } = await sb.from('profiles').insert({ id: data.user.id, login_id: loginId, role: a.role, ref_type: a.refType || null, ref_id: a.refId || '', name: a.name || '' });
    console.log(line + (pe ? ' — 프로필 실패: ' + pe.message : ' — 생성됨'));
  }
}
console.log('\n완료');
