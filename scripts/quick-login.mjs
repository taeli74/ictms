// 테스트용 "로그인 없이 사용" 계정 관리
//   npm run quick-login -- on    : test-admin 계정(통합관리자)을 만들고 .env.local 에 VITE_QUICK_LOGIN 을 기록
//   npm run quick-login -- off   : test-admin 계정을 삭제하고 .env.local 에서 지움
// 실서비스에 반영/해제하려면 Vercel 환경변수 VITE_QUICK_LOGIN 도 추가/삭제 후 다시 배포해야 합니다.
// 비밀번호는 화면에 출력하지 않습니다.
import { readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const mode = process.argv[2];
const LOGIN = 'test-admin';
const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, LOGIN_DOMAIN = 'ictms.local' } = process.env;
const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const envFile = '.env.local';
const setEnv = v => {
  let t = readFileSync(envFile, 'utf8').split('\n').filter(l => !l.startsWith('VITE_QUICK_LOGIN=')).join('\n').replace(/\n*$/, '\n');
  if (v) t += `VITE_QUICK_LOGIN=${v}\n`;
  writeFileSync(envFile, t);
};
const { data: ex } = await sb.from('profiles').select('id').eq('login_id', LOGIN).maybeSingle();

if (mode === 'on') {
  const pw = randomBytes(18).toString('base64url');
  if (ex) {
    const { error } = await sb.auth.admin.updateUserById(ex.id, { password: pw });
    if (error) throw error;
  } else {
    const { data, error } = await sb.auth.admin.createUser({ email: `${LOGIN}@${LOGIN_DOMAIN}`, password: pw, email_confirm: true });
    if (error) throw error;
    const { error: pe } = await sb.from('profiles').insert({ id: data.user.id, login_id: LOGIN, role: 'admin', name: '테스트 관리자' });
    if (pe) { await sb.auth.admin.deleteUser(data.user.id); throw pe; }
  }
  setEnv(`${LOGIN}:${pw}`);
  console.log(`'${LOGIN}' 계정 준비 완료, .env.local 에 VITE_QUICK_LOGIN 기록`);
} else if (mode === 'off') {
  if (ex) await sb.auth.admin.deleteUser(ex.id);
  setEnv(null);
  console.log(`'${LOGIN}' 계정 삭제, .env.local 에서 VITE_QUICK_LOGIN 제거`);
} else {
  console.error('사용법: npm run quick-login -- on | off');
  process.exit(1);
}
