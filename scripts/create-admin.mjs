// 첫 통합관리자 계정 만들기 (한 번만 실행)
//   npm run create-admin -- <아이디> <비밀번호>
// .env.server 의 SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY 를 사용합니다.
import { createClient } from '@supabase/supabase-js';

const [loginId = 'admin', pw] = process.argv.slice(2);
if (!pw || pw.length < 8) { console.error('사용법: npm run create-admin -- <아이디> <비밀번호(8자 이상)>'); process.exit(1); }
const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, LOGIN_DOMAIN = 'ictms.local' } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) { console.error('.env.server 를 먼저 채우세요.'); process.exit(1); }

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const { data: exists } = await sb.from('profiles').select('id,role').eq('login_id', loginId).maybeSingle();
if (exists) {
  if (!process.argv.includes('--reset')) {
    console.error(`이미 '${loginId}' 계정이 있습니다. 비밀번호를 새로 정하려면 끝에 --reset 을 붙여 다시 실행하세요.`);
    process.exit(1);
  }
  const { error } = await sb.auth.admin.updateUserById(exists.id, { password: pw });
  if (error) { console.error('비밀번호 변경 실패:', error.message); process.exit(1); }
  console.log(`'${loginId}' 계정(${exists.role})의 비밀번호를 새로 정했습니다.`);
  process.exit(0);
}

const { data, error } = await sb.auth.admin.createUser({ email: `${loginId}@${LOGIN_DOMAIN}`, password: pw, email_confirm: true });
if (error) { console.error('생성 실패:', error.message); process.exit(1); }
const { error: pe } = await sb.from('profiles').insert({ id: data.user.id, login_id: loginId, role: 'admin', name: '통합관리자' });
if (pe) { await sb.auth.admin.deleteUser(data.user.id); console.error('프로필 생성 실패:', pe.message); process.exit(1); }
console.log(`통합관리자 '${loginId}' 계정을 만들었습니다.`);
