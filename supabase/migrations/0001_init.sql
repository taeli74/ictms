-- Easy ICT Master — Supabase 초기 스키마
-- Supabase 대시보드 > SQL Editor 에 통째로 붙여넣고 실행하세요 (한 번만).
--
-- 구조: 앱의 컬렉션(sites, inspections …)을 docs 테이블 한 곳에 JSON으로 그대로 저장합니다.
-- 권한 범위는 앱의 applyScope() 와 같은 규칙을 DB(RLS)가 강제합니다.
--   admin    : 전체
--   engineer : 자기 업체(ownerId)의 사이트와 그 하위 데이터
--   client   : 자기 고객사(clientId)의 사이트와 그 하위 데이터

-- ───────── 사용자 프로필 (로그인 계정 = auth.users) ─────────
create table public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  login_id   text not null unique check (login_id ~ '^[a-z0-9._-]{3,20}$'),
  role       text not null check (role in ('admin','engineer','client')),
  ref_type   text check (ref_type in ('company','person','client')),
  ref_id     text not null default '',
  name       text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.profiles enable row level security;

-- ───────── 업무 데이터 ─────────
create table public.docs (
  collection text not null check (collection in
    ('sites','inspections','issues','companies','people','clients','memos','locations','cables','cabchecks')),
  id         text not null,
  data       jsonb not null,
  site_id    text generated always as (data->>'siteId')    stored,
  owner_id   text generated always as (data->>'ownerId')   stored,
  client_id  text generated always as (data->>'clientId')  stored,
  company_id text generated always as (data->>'companyId') stored,
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid(),
  primary key (collection, id)
);
create index docs_site_idx   on public.docs (collection, site_id);
create index docs_owner_idx  on public.docs (collection, owner_id);
create index docs_client_idx on public.docs (collection, client_id);
alter table public.docs replica identity full;          -- 실시간 삭제 이벤트에 키 포함
alter table public.docs enable row level security;

create function public.touch_docs() returns trigger language plpgsql as $$
begin new.updated_at := now(); new.updated_by := auth.uid(); return new; end $$;
create trigger docs_touch before update on public.docs for each row execute function public.touch_docs();

-- ───────── 권한 판정 함수 (RLS를 우회해 읽으므로 security definer) ─────────
create function public.my_role() returns text
language sql stable security definer set search_path = '' as $$
  select role from public.profiles where id = auth.uid()
$$;

create function public.my_company() returns text
language sql stable security definer set search_path = '' as $$
  select case
    when p.role <> 'engineer' then null
    when p.ref_type = 'company' then p.ref_id
    when p.ref_type = 'person' then (select d.data->>'companyId' from public.docs d
                                      where d.collection = 'people' and d.id = p.ref_id)
  end
  from public.profiles p where p.id = auth.uid()
$$;

create function public.my_client() returns text
language sql stable security definer set search_path = '' as $$
  select case when role = 'client' then ref_id end from public.profiles where id = auth.uid()
$$;

create function public.can_see_site(sid text) returns boolean
language sql stable security definer set search_path = '' as $$
  select case public.my_role()
    when 'admin' then true
    when 'engineer' then exists (select 1 from public.docs s where s.collection = 'sites' and s.id = sid
                                  and s.owner_id = public.my_company())
    when 'client' then exists (select 1 from public.docs s where s.collection = 'sites' and s.id = sid
                                and s.client_id = public.my_client())
    else false end
$$;

create function public.doc_visible(col text, did text, sid text, own text, cli text, comp text) returns boolean
language sql stable security definer set search_path = '' as $$
  select case
    when public.my_role() is null then false
    when public.my_role() = 'admin' then true
    when col = 'sites' then
      case public.my_role() when 'engineer' then own = public.my_company()
                            when 'client'   then cli = public.my_client() end
    when col in ('inspections','issues','locations','cables','cabchecks') then public.can_see_site(sid)
    when col = 'clients' then
      case public.my_role()
        when 'engineer' then own = public.my_company()
          or exists (select 1 from public.docs s where s.collection = 'sites' and s.client_id = did
                      and s.owner_id = public.my_company())
        when 'client' then did = public.my_client() end
    when col = 'companies' then
      case public.my_role()
        when 'engineer' then true
        when 'client' then cli = public.my_client()
          or exists (select 1 from public.docs s where s.collection = 'sites' and s.owner_id = did
                      and s.client_id = public.my_client()) end
    when col = 'people' then
      case public.my_role()
        when 'engineer' then true
        when 'client' then exists (select 1 from public.docs s where s.collection = 'sites'
                                    and s.owner_id = comp and s.client_id = public.my_client()) end
    when col = 'memos' then true
    else false end
$$;

-- ───────── RLS 정책 ─────────
create policy profiles_read on public.profiles for select to authenticated
  using (id = auth.uid() or public.my_role() = 'admin');
-- profiles 쓰기는 Edge Function(admin-users)이 service role로만 합니다.

create policy docs_read on public.docs for select to authenticated
  using (public.doc_visible(collection, id, site_id, owner_id, client_id, company_id));
create policy docs_insert on public.docs for insert to authenticated
  with check (public.doc_visible(collection, id, site_id, owner_id, client_id, company_id));
create policy docs_update on public.docs for update to authenticated
  using (public.doc_visible(collection, id, site_id, owner_id, client_id, company_id))
  with check (public.doc_visible(collection, id, site_id, owner_id, client_id, company_id));
create policy docs_delete on public.docs for delete to authenticated
  using (public.doc_visible(collection, id, site_id, owner_id, client_id, company_id));

-- 기준정보(업체·고객사·인력) 쓰기 제한: 관리자 전체, 업체는 자기 업체·자기 고객사·자기 인력, 고객사는 자기 정보만
create function public.master_writable(col text, did text, own text, comp text) returns boolean
language sql stable security definer set search_path = '' as $$
  select col not in ('companies','clients','people') or public.my_role() = 'admin'
      or (col = 'companies' and did = public.my_company())
      or (col = 'clients' and (own = public.my_company() or did = public.my_client()))
      or (col = 'people' and comp = public.my_company())
$$;
create policy docs_master_ins on public.docs as restrictive for insert to authenticated
  with check (public.master_writable(collection, id, owner_id, company_id));
create policy docs_master_upd on public.docs as restrictive for update to authenticated
  using (public.master_writable(collection, id, owner_id, company_id))
  with check (public.master_writable(collection, id, owner_id, company_id));
create policy docs_master_admin_del on public.docs as restrictive for delete to authenticated
  using (collection not in ('companies','clients','people') or public.my_role() = 'admin');

-- ───────── 실시간 동기화 ─────────
alter publication supabase_realtime add table public.docs, public.profiles;

-- ───────── 사진 저장소 (비공개 버킷) ─────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos', 'photos', false, 10485760, array['image/jpeg','image/png','image/webp','image/gif'])
on conflict (id) do nothing;

create policy photos_read on storage.objects for select to authenticated
  using (bucket_id = 'photos' and public.my_role() is not null);
create policy photos_write on storage.objects for insert to authenticated
  with check (bucket_id = 'photos' and public.my_role() is not null);
create policy photos_delete on storage.objects for delete to authenticated
  using (bucket_id = 'photos' and public.my_role() = 'admin');
