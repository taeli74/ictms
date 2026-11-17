// Easy ICT Master — 계정 발급/수정/삭제 (통합관리자 전용)
// 배포: npx supabase functions deploy admin-users --project-ref <프로젝트 ref>
// SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY 는 Supabase가 자동으로 넣어 줍니다.
// LOGIN_DOMAIN 은 필요하면 `npx supabase secrets set LOGIN_DOMAIN=ictms.local` 로 설정 (기본 ictms.local).
import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const URL_ = Deno.env.get('SUPABASE_URL')!;
const DOMAIN = Deno.env.get('LOGIN_DOMAIN') || 'ictms.local';
const ROLES = ['admin', 'engineer', 'client'];
const REFS = ['company', 'person', 'client', null];
const ID_RE = /^[a-z0-9._-]{3,20}$/;
const emailOf = (id: string) => `${id}@${DOMAIN}`;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'POST만 허용됩니다.' }, 405);

  // 1) 호출한 사람이 통합관리자인지 확인
  const auth = req.headers.get('Authorization') || '';
  const asCaller = createClient(URL_, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } } });
  const { data: { user: caller } } = await asCaller.auth.getUser();
  if (!caller) return json({ error: '로그인이 필요합니다.' }, 401);

  const svc = createClient(URL_, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  const { data: cp } = await svc.from('profiles').select('role').eq('id', caller.id).maybeSingle();
  if (cp?.role !== 'admin') return json({ error: '통합관리자만 계정을 관리할 수 있습니다.' }, 403);

  let b: Record<string, any>;
  try { b = await req.json(); } catch { return json({ error: '잘못된 요청' }, 400); }
  const byLogin = async (id: string) =>
    (await svc.from('profiles').select('*').eq('login_id', id).maybeSingle()).data;

  // 2) 삭제
  if (b.action === 'delete') {
    const p = await byLogin(String(b.login_id || ''));
    if (!p) return json({ ok: true, note: '이미 없음' });
    if (p.id === caller.id) return json({ error: '자기 계정은 삭제할 수 없습니다.' }, 400);
    const { error } = await svc.auth.admin.deleteUser(p.id);   // profiles는 cascade로 함께 삭제
    if (error) return json({ error: error.message }, 400);
    return json({ ok: true });
  }

  // 3) 생성·수정
  if (b.action === 'upsert') {
    const login_id = String(b.login_id || '').trim().toLowerCase();
    const pw: string | null = b.password || null;
    if (!ID_RE.test(login_id)) return json({ error: '아이디는 영문 소문자·숫자·._- 3~20자' }, 400);
    if (!ROLES.includes(b.role)) return json({ error: '역할이 올바르지 않습니다.' }, 400);
    if (!REFS.includes(b.ref_type ?? null)) return json({ error: '연결 대상이 올바르지 않습니다.' }, 400);
    if (pw && pw.length < 8) return json({ error: '비밀번호는 8자 이상' }, 400);

    const row = { login_id, role: b.role, ref_type: b.ref_type ?? null, ref_id: String(b.ref_id || ''), name: String(b.name || ''), updated_at: new Date().toISOString() };
    const old = b.old_login_id ? await byLogin(String(b.old_login_id)) : await byLogin(login_id);

    if (old) {
      if (old.id === caller.id && row.role !== 'admin') return json({ error: '자기 계정의 관리자 권한은 해제할 수 없습니다.' }, 400);
      if (login_id !== old.login_id && (await byLogin(login_id))) return json({ error: '이미 사용 중인 아이디입니다.' }, 409);
      const patch: Record<string, unknown> = {};
      if (login_id !== old.login_id) patch.email = emailOf(login_id);
      if (pw) patch.password = pw;
      if (Object.keys(patch).length) {
        const { error } = await svc.auth.admin.updateUserById(old.id, { ...patch, email_confirm: true });
        if (error) return json({ error: error.message }, 400);
      }
      const { error } = await svc.from('profiles').update(row).eq('id', old.id);
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true, id: old.id });
    }

    if (b.old_login_id) return json({ error: '바꾸려는 계정을 찾을 수 없습니다.' }, 404);
    if (!pw) return json({ error: '새 계정은 비밀번호가 필요합니다.' }, 400);
    const { data: made, error } = await svc.auth.admin.createUser({ email: emailOf(login_id), password: pw, email_confirm: true });
    if (error || !made.user) return json({ error: error?.message || '계정 생성 실패' }, 400);
    const { error: pe } = await svc.from('profiles').insert({ id: made.user.id, ...row });
    if (pe) { await svc.auth.admin.deleteUser(made.user.id); return json({ error: pe.message }, 400); }
    return json({ ok: true, id: made.user.id });
  }

  return json({ error: '알 수 없는 action' }, 400);
});
