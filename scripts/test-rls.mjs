// 권한(RLS)·계정 함수·사진 저장 자동 점검 — 테스트 계정/데이터를 만들고 확인한 뒤 모두 지웁니다.
//   node --env-file=.env.server --env-file=.env.local scripts/test-rls.mjs
import { createClient } from '@supabase/supabase-js';
import { randomBytes } from 'node:crypto';

const URL_ = process.env.SUPABASE_URL, SVC = process.env.SUPABASE_SERVICE_ROLE_KEY, ANON = process.env.VITE_SUPABASE_ANON_KEY;
const DOMAIN = process.env.LOGIN_DOMAIN || 'ictms.local';
const opts = { auth: { persistSession: false } };
const svc = createClient(URL_, SVC, opts);
const T = 'zztest';   // 테스트 데이터 접두어
let pass = 0, failN = 0;
const ok = (cond, msg) => { cond ? pass++ : failN++; console.log((cond ? '  ✅ ' : '  ❌ ') + msg); };

const users = [];
async function mkUser(login, role, ref_type, ref_id) {
  const pw = randomBytes(12).toString('base64url');
  const { data, error } = await svc.auth.admin.createUser({ email: `${login}@${DOMAIN}`, password: pw, email_confirm: true });
  if (error) throw error;
  users.push(data.user.id);
  const { error: pe } = await svc.from('profiles').insert({ id: data.user.id, login_id: login, role, ref_type, ref_id, name: login });
  if (pe) throw pe;
  const c = createClient(URL_, ANON, opts);
  const { error: se } = await c.auth.signInWithPassword({ email: `${login}@${DOMAIN}`, password: pw });
  if (se) throw se;
  return c;
}
const ids = async (c, col) => ((await c.from('docs').select('id').eq('collection', col).like('id', T + '%')).data || []).map(r => r.id).sort();

try {
  // 기준 데이터: 업체 A·B, 고객사 X·Y, 사이트 A-X, B-Y, 각 사이트의 점검·이슈
  const D = (collection, id, data) => ({ collection, id: `${T}-${id}`, data });
  const seed = [
    D('companies', 'coA', { name: '테스트업체A' }), D('companies', 'coB', { name: '테스트업체B' }),
    D('clients', 'kX', { name: '테스트고객X', ownerId: `${T}-coA` }), D('clients', 'kY', { name: '테스트고객Y', ownerId: `${T}-coB` }),
    D('people', 'pA', { name: '기사A', companyId: `${T}-coA` }), D('people', 'pB', { name: '기사B', companyId: `${T}-coB` }),
    D('sites', 'sAX', { name: '사이트AX', ownerId: `${T}-coA`, clientId: `${T}-kX` }),
    D('sites', 'sBY', { name: '사이트BY', ownerId: `${T}-coB`, clientId: `${T}-kY` }),
    D('inspections', 'iAX', { siteId: `${T}-sAX`, type: 'm' }), D('inspections', 'iBY', { siteId: `${T}-sBY`, type: 'm' }),
    D('issues', 'xAX', { siteId: `${T}-sAX`, status: 'open' }), D('issues', 'xBY', { siteId: `${T}-sBY`, status: 'open' }),
  ];
  const { error: se } = await svc.from('docs').upsert(seed);
  if (se) throw se;

  const admin = await mkUser(`${T}admin`, 'admin', null, '');
  const engA = await mkUser(`${T}enga`, 'engineer', 'company', `${T}-coA`);
  const engP = await mkUser(`${T}engp`, 'engineer', 'person', `${T}-pB`);   // 인력 계정 → 업체B
  const cliX = await mkUser(`${T}clix`, 'client', 'client', `${T}-kX`);
  const anon = createClient(URL_, ANON, opts);

  console.log('\n[읽기 범위]');
  ok((await ids(anon, 'sites')).length === 0, '로그인 안 한 사용자: 사이트 0건');
  ok((await ids(admin, 'sites')).length === 2, '관리자: 사이트 2건 모두');
  ok(JSON.stringify(await ids(engA, 'sites')) === JSON.stringify([`${T}-sAX`]), '업체A: 자기 사이트(AX)만');
  ok(JSON.stringify(await ids(engA, 'inspections')) === JSON.stringify([`${T}-iAX`]), '업체A: 자기 사이트 점검만');
  ok(JSON.stringify(await ids(engA, 'clients')) === JSON.stringify([`${T}-kX`]), '업체A: 자기 고객사(X)만');
  ok(JSON.stringify(await ids(engP, 'sites')) === JSON.stringify([`${T}-sBY`]), '인력 계정(업체B 소속): 업체B 사이트만');
  ok(JSON.stringify(await ids(cliX, 'sites')) === JSON.stringify([`${T}-sAX`]), '고객사X: 자기 사이트만');
  ok(JSON.stringify(await ids(cliX, 'issues')) === JSON.stringify([`${T}-xAX`]), '고객사X: 자기 사이트 이슈만');
  ok(JSON.stringify(await ids(cliX, 'people')) === JSON.stringify([`${T}-pA`]), '고객사X: 담당 업체 인력만');
  ok((await cliX.from('profiles').select('login_id')).data.length === 1, '고객사X: 계정 목록은 자기 것만');

  console.log('\n[쓰기 범위]');
  let r = await engA.from('docs').upsert({ collection: 'inspections', id: `${T}-iAX2`, data: { siteId: `${T}-sAX` } });
  ok(!r.error, '업체A: 자기 사이트에 점검 저장 가능');
  r = await engA.from('docs').upsert({ collection: 'inspections', id: `${T}-iBY2`, data: { siteId: `${T}-sBY` } });
  ok(!!r.error, '업체A: 남의 사이트에 점검 저장 차단');
  r = await engA.from('docs').update({ data: { siteId: `${T}-sBY`, hacked: 1 } }).eq('collection', 'inspections').eq('id', `${T}-iBY`).select();
  ok(!r.data || r.data.length === 0, '업체A: 남의 점검 수정 차단');
  r = await engA.from('docs').upsert({ collection: 'sites', id: `${T}-sAX`, data: { name: 'x', ownerId: `${T}-coB` } });
  ok(!!r.error, '업체A: 자기 사이트를 다른 업체로 넘기기 차단');
  r = await engA.from('docs').upsert({ collection: 'companies', id: `${T}-coB`, data: { name: '변조' } });
  ok(!!r.error, '업체A: 다른 업체 정보 수정 차단');
  r = await cliX.from('docs').upsert({ collection: 'issues', id: `${T}-xAX2`, data: { siteId: `${T}-sAX`, status: 'open' } });
  ok(!r.error, '고객사X: 자기 사이트에 이슈 등록 가능');
  r = await cliX.from('docs').delete().eq('collection', 'people').eq('id', `${T}-pA`).select();
  ok(!r.data || r.data.length === 0, '고객사X: 인력 삭제 차단');
  r = await anon.from('docs').upsert({ collection: 'sites', id: `${T}-anon`, data: {} });
  ok(!!r.error, '로그인 안 한 사용자: 저장 차단');

  console.log('\n[계정 함수 admin-users]');
  const call = async (c, body) => { const { data, error } = await c.functions.invoke('admin-users', { body }); let m = null; if (error) { try { m = (await error.context.json()).error; } catch { m = error.message; } } return { data, err: m }; };
  let f = await call(engA, { action: 'upsert', login_id: `${T}hack`, role: 'admin', password: 'x'.repeat(10) });
  ok(!!f.err, '업체 계정은 계정 생성 불가: ' + f.err);
  f = await call(admin, { action: 'upsert', login_id: `${T}new`, role: 'client', ref_type: 'client', ref_id: `${T}-kY`, name: '새고객', password: randomBytes(9).toString('base64url') });
  ok(!f.err, '관리자: 고객 계정 생성');
  f = await call(admin, { action: 'upsert', login_id: `${T}new2`, old_login_id: `${T}new`, role: 'client', ref_type: 'client', ref_id: `${T}-kY`, name: '새고객' });
  ok(!f.err, '관리자: 아이디 변경');
  f = await call(admin, { action: 'upsert', login_id: `${T}x`, role: 'client', password: 'short' });
  ok(!!f.err, '8자 미만 비밀번호 거절');
  f = await call(admin, { action: 'delete', login_id: `${T}new2` });
  ok(!f.err, '관리자: 계정 삭제');
  ok(!(await svc.from('profiles').select('id').like('login_id', `${T}new%`)).data.length, '삭제된 계정 프로필도 사라짐');

  console.log('\n[사진 저장소]');
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
  const pid = `ph-${T}-0000-0000-0000-000000000000`;
  r = await engA.storage.from('photos').upload(pid, png, { contentType: 'image/png' });
  ok(!r.error, '업체A: 사진 업로드' + (r.error ? ' — ' + r.error.message : ''));
  const sg = await cliX.storage.from('photos').createSignedUrls([pid], 60);
  const su = sg.data && sg.data[0] && sg.data[0].signedUrl;
  ok(!!su && (await fetch(su)).status === 200, '로그인한 사용자: 서명 URL로 사진 열람');
  r = await anon.storage.from('photos').createSignedUrls([pid], 60);
  ok(!(r.data && r.data[0] && r.data[0].signedUrl), '로그인 안 한 사용자: 사진 URL 발급 차단');
  ok((await fetch(`${URL_}/storage/v1/object/public/photos/${pid}`)).status >= 400, '공개 주소로는 사진 접근 불가');
  r = await engA.storage.from('photos').remove([pid]);
  ok(!(r.data && r.data.length), '업체A: 사진 삭제 차단 (관리자만)');
  await svc.storage.from('photos').remove([pid]);
} catch (e) {
  failN++; console.error('\n중단됨:', e.message || e);
} finally {
  await svc.from('docs').delete().like('id', `${T}-%`);
  for (const id of users) await svc.auth.admin.deleteUser(id);
  const { data: left } = await svc.from('profiles').select('login_id').like('login_id', `${T}%`);
  for (const p of left || []) { const { data } = await svc.from('profiles').select('id').eq('login_id', p.login_id).single(); await svc.auth.admin.deleteUser(data.id); }
  console.log(`\n정리 완료 (테스트 계정·데이터 삭제). 결과: 통과 ${pass} / 실패 ${failN}`);
  process.exit(failN ? 1 : 0);
}
