// Easy ICT Master — Supabase 어댑터
// 아티팩트 런타임(window.claude.use('db'|'assets'|'downloads'|'user'))과 같은 모양의 객체를
// Supabase로 구현해서, 화면 코드(public/app.js)는 거의 그대로 동작하게 합니다.
import { createClient } from '@supabase/supabase-js';

const env = import.meta.env;
if (!env.VITE_SUPABASE_URL || !env.VITE_SUPABASE_ANON_KEY) {
  document.getElementById('app').innerHTML =
    '<div class="card err">VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY 환경변수가 없습니다. .env.local 을 확인하세요.</div>';
  throw new Error('Supabase env missing');
}
const DOMAIN = env.VITE_LOGIN_DOMAIN || 'ictms.local';
const BUCKET = 'photos';
const PAGE = 1000;

const sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true },
});

/* ───────── 상태 ───────── */
let me = null;                       // profiles 행 (+ email)
const stores = new Map();            // collection → Map(id → data)
const subs = new Map();              // collection → [callback]
const loaded = new Set();

const toAcct = p => p && { id: p.login_id, role: p.role, refType: p.ref_type || null, refId: p.ref_id || '', name: p.name || '' };
const emailOf = id => (id.includes('@') ? id : `${id}@${DOMAIN}`);
const fail = (e, fallback) => {
  const err = new Error(e?.message || fallback || '요청 실패');
  err.code = e?.code === '42501' ? '권한 없음' : (e?.code || 'error');
  return err;
};

/* ───────── 스냅샷 전달 ───────── */
const snap = name => {
  const m = stores.get(name) || new Map();
  return { docs: [...m].map(([id, data]) => ({ id, data: () => data })) };
};
const timers = new Map();
function notify(name) {
  clearTimeout(timers.get(name));
  timers.set(name, setTimeout(() => {
    const s = snap(name);
    (subs.get(name) || []).forEach(cb => { try { cb(s); } catch (e) { console.error(e); } });
  }, 30));
}

async function load(name) {
  const m = new Map();
  if (name === 'accounts') {
    if (me) {
      const { data, error } = await sb.from('profiles').select('*');
      if (error) throw fail(error);
      data.forEach(p => m.set(p.login_id, toAcct(p)));
    }
  } else if (me) {
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await sb.from('docs').select('id,data')
        .eq('collection', name).order('id').range(from, from + PAGE - 1);
      if (error) throw fail(error);
      data.forEach(r => m.set(r.id, r.data));
      if (data.length < PAGE) break;
    }
    prefetchPhotos(m);
  }
  stores.set(name, m);
  loaded.add(name);
  notify(name);
}
const reloadAll = () => Promise.all([...subs.keys()].map(n => load(n).catch(e => console.error(n, e))));

/* ───────── 실시간 ───────── */
let channel = null;
function listen() {
  if (channel) sb.removeChannel(channel);
  channel = null;
  if (!me) return;
  channel = sb.channel('ictms')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'docs' }, ({ eventType, new: n, old: o }) => {
      const col = (n && n.collection) || (o && o.collection);
      if (!col || !stores.has(col)) return;
      if (eventType === 'DELETE') stores.get(col).delete(o.id);
      else { stores.get(col).set(n.id, n.data); prefetchPhotos(new Map([[n.id, n.data]])); }
      notify(col);
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, () => {
      if (subs.has('accounts')) load('accounts').catch(console.error);
    })
    .subscribe();
}

/* ───────── db ───────── */
const db = {
  collection: name => ({
    onSnapshot(cb, onErr) {
      if (!subs.has(name)) subs.set(name, []);
      subs.get(name).push(cb);
      if (loaded.has(name)) setTimeout(() => cb(snap(name)), 0);
      else load(name).catch(e => onErr && onErr(e));
      return () => subs.set(name, (subs.get(name) || []).filter(x => x !== cb));
    },
    doc: id => ({
      async set(d) {
        if (name === 'accounts') throw new Error('계정은 putAccount로 저장합니다.');
        const data = JSON.parse(JSON.stringify(d));
        const { error } = await sb.from('docs').upsert({ collection: name, id, data });
        if (error) throw fail(error, '저장 실패');
        if (!stores.has(name)) stores.set(name, new Map());
        stores.get(name).set(id, data);
        notify(name);
      },
      async delete() {
        if (name === 'accounts') {
          await admin({ action: 'delete', login_id: id });
          stores.get('accounts')?.delete(id);
          notify('accounts');
          return;
        }
        const { error } = await sb.from('docs').delete().eq('collection', name).eq('id', id);
        if (error) throw fail(error, '삭제 실패');
        stores.get(name)?.delete(id);
        notify(name);
      },
    }),
  }),
};

/* ───────── 계정 (Supabase Auth + Edge Function) ───────── */
async function admin(body) {
  const { data, error } = await sb.functions.invoke('admin-users', { body });
  if (error) {
    let msg = error.message;
    try { msg = (await error.context.json()).error || msg; } catch (_) { /* ignore */ }
    throw new Error(msg);
  }
  return data;
}
async function loadMe() {
  const { data: { user } } = await sb.auth.getUser();
  if (!user) { me = null; return null; }
  const { data, error } = await sb.from('profiles').select('*').eq('id', user.id).maybeSingle();
  if (error) throw fail(error);
  me = data ? { ...data, email: user.email } : null;
  return me;
}
async function afterAuth() {
  if (!me) { await sb.auth.signOut(); throw new Error('계정 정보(프로필)가 없습니다. 통합관리자에게 문의하세요.'); }
  await reloadAll();
  listen();
  return toAcct(me);
}

/* ───────── 사진 (비공개 Storage + 서명 URL) ───────── */
const PHOTO_RE = /^(ph-[0-9a-f-]{36}|[0-9a-f]{32}|p[0-9a-z]{12,16})$/;
const urls = new Map();     // id → { url, exp }
const want = new Set();
let signTimer = null;
const fresh = id => { const c = urls.get(id); return c && c.exp > Date.now() ? c.url : null; };
const placeholder = id => '/_blob/' + id;

function queueSign(id) {
  if (fresh(id)) return;
  want.add(id);
  clearTimeout(signTimer);
  signTimer = setTimeout(signNow, 40);
}
async function signNow() {
  const ids = [...want]; want.clear();
  for (let i = 0; i < ids.length; i += 100) {
    const part = ids.slice(i, i + 100);
    const { data, error } = await sb.storage.from(BUCKET).createSignedUrls(part, 3600);
    if (error) { console.warn('사진 URL 발급 실패', error); continue; }
    data.forEach(r => {
      if (!r.signedUrl || r.error) return;
      const id = r.path;
      urls.set(id, { url: r.signedUrl, exp: Date.now() + 55 * 60 * 1000 });
      document.querySelectorAll(`img[src="${placeholder(id)}"]`).forEach(img => { img.src = r.signedUrl; });
    });
  }
}
function prefetchPhotos(m) {
  const walk = v => {
    if (typeof v === 'string') { if (PHOTO_RE.test(v)) queueSign(v); }
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  m.forEach(walk);
}
// 화면 코드가 동기적으로 부르는 함수: 서명 URL이 있으면 그것을, 없으면 자리표시 경로를 돌려주고 발급 후 교체합니다.
window.blobUrl = id => fresh(id) || (queueSign(id), placeholder(id));

const assets = {
  async upload(blob) {
    const id = 'ph-' + crypto.randomUUID();
    const { error } = await sb.storage.from(BUCKET).upload(id, blob, { contentType: blob.type || 'image/jpeg', upsert: false });
    if (error) throw fail(error, '사진 업로드 실패');
    urls.set(id, { url: URL.createObjectURL(blob), exp: Date.now() + 6 * 3600 * 1000 });
    return { id };
  },
};

/* ───────── 파일 내려받기 ───────── */
const downloads = {
  async save({ filename, data }) {
    const u = URL.createObjectURL(data);
    const a = Object.assign(document.createElement('a'), { href: u, download: filename });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(u), 4000);
    return { status: 'saved' };
  },
};

/* ───────── 권한 (실제 판정은 DB의 RLS가 합니다) ───────── */
const user = { can: () => true, canEdit: () => true };

/* ───────── 앱에서 쓰는 함수 ───────── */
window.ICTMS = {
  supabase: sb,
  demoAccounts: (env.VITE_DEMO_ACCOUNTS || '').split(',').map(s => s.trim()).filter(Boolean).map(s => s.split(':')),
  async signIn(id, pw) {
    const { error } = await sb.auth.signInWithPassword({ email: emailOf(id), password: pw });
    if (error) throw new Error('아이디 또는 비밀번호가 맞지 않습니다.');
    await loadMe();
    return afterAuth();
  },
  async restore() {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) return null;
    try { await loadMe(); return me ? await afterAuth() : null; } catch (e) { console.error(e); return null; }
  },
  async signOut() {
    me = null;
    await sb.auth.signOut();
    listen();
    for (const n of stores.keys()) { stores.set(n, new Map()); notify(n); }
  },
  async verifyPassword(pw) {
    if (!me || !pw) return false;
    const { error } = await sb.auth.signInWithPassword({ email: me.email, password: pw });
    return !error;
  },
  // app.js 의 putAccount(id, f, pw, old) 대체
  async putAccount(id, f, pw, old) {
    const self = me && old && old.id === me.login_id;
    if (self && id === old.id) {          // 내 비밀번호만 변경 (아이디 그대로)
      if (pw) { const { error } = await sb.auth.updateUser({ password: pw }); if (error) throw fail(error, '비밀번호 변경 실패'); }
      return;
    }
    await admin({
      action: 'upsert', login_id: id, old_login_id: old ? old.id : null,
      role: f.role, name: f.name || '', ref_type: f.refType || null, ref_id: f.refId || '', password: pw || null,
    });
    if (self) await loadMe();
    await load('accounts');
  },
  async photoUrl(id) {
    if (!fresh(id)) { want.add(id); await signNow(); }
    return fresh(id) || placeholder(id);
  },
};

/* 관리자 백업: 화면에서 볼 수 있는 모든 데이터를 JSON으로 내려받기 (사진은 Storage에 그대로 남음) */
window.backupCard = function () {
  const h = window.h;                     // app.js 의 DOM 헬퍼
  const msg = h('div');
  const exp = async () => {
    const out = { app: 'easy-ict-master', v: 2, source: 'supabase', at: new Date().toISOString(), db: {} };
    for (const [n, m] of stores) if (n !== 'accounts') out.db[n] = Object.fromEntries(m);
    await downloads.save({ filename: 'easy-ict-master-' + new Date().toISOString().slice(0, 10).replace(/-/g, '') + '.json',
      data: new Blob([JSON.stringify(out)], { type: 'application/json' }) });
    msg.replaceChildren(h('div', { class: 'note' }, '백업 파일을 내려받았습니다.'));
  };
  return h('div', { class: 'card' }, h('h3', {}, '데이터 백업'),
    h('div', { class: 'muted', style: 'margin-bottom:10px' }, '서버(Supabase)에 저장된 데이터를 JSON 파일로 내려받습니다. 사진은 서버 저장소에 그대로 보관됩니다. 서버 자체 백업과 별도로 정기적으로 받아 두세요.'),
    h('div', { class: 'row' }, h('button', { class: 'pri', onclick: exp }, '백업 내려받기'), h('div', { class: 'grow' }), msg));
};

window.claude = { use: async n => ({ db, assets, downloads, user })[n] || null };

// 세션 토큰이 바뀌면(자동 갱신·다른 탭 로그아웃) 실시간 채널을 다시 붙입니다.
sb.auth.onAuthStateChange((ev) => {
  if (ev === 'SIGNED_OUT' && me) { me = null; location.reload(); }
  if (ev === 'TOKEN_REFRESHED' && me) listen();
});

// 어댑터 준비가 끝난 뒤 화면 코드를 불러옵니다.
const s = document.createElement('script');
s.src = '/app.js?v=' + __BUILD__;
document.body.appendChild(s);
