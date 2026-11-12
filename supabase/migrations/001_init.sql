-- Voxen başlangıç şeması: tablolar, RLS politikaları, RPC'ler, avatar deposu.

-- ========== TABLOLAR ==========

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique check (char_length(username) between 3 and 20),
  color text not null default '#5865f2',
  created_at timestamptz not null default now()
);

create table public.servers (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 40),
  owner_id uuid not null references auth.users(id) on delete cascade,
  invite_code text not null unique,
  created_at timestamptz not null default now()
);

create table public.server_members (
  server_id uuid not null references public.servers(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (server_id, user_id)
);

create table public.channels (
  id uuid primary key default gen_random_uuid(),
  server_id uuid not null references public.servers(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 30),
  kind text not null check (kind in ('text','voice')),
  position int not null default 0
);

create table public.messages (
  id bigint generated always as identity primary key,
  channel_id uuid not null references public.channels(id) on delete cascade,
  author_id uuid not null references auth.users(id) on delete cascade,
  content text not null check (length(content) between 1 and 2000),
  created_at timestamptz not null default now()
);

create index messages_channel_idx on public.messages (channel_id, id desc);
create index channels_server_idx on public.channels (server_id);

-- ========== YARDIMCI FONKSİYON ==========
-- Çağıran kullanıcı bu sunucunun üyesi mi? security definer: RLS'yi atlar,
-- böylece server_members politikası kendi kendini çağırıp sonsuz döngüye girmez.
create function public.is_member(sid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.server_members
    where server_id = sid and user_id = auth.uid()
  );
$$;

-- ========== RLS ==========

alter table public.profiles enable row level security;
alter table public.servers enable row level security;
alter table public.server_members enable row level security;
alter table public.channels enable row level security;
alter table public.messages enable row level security;

-- profiles: giriş yapan herkes okur, sadece kendi satırını ekler/günceller
create policy profiles_select on public.profiles
  for select to authenticated using (true);
create policy profiles_insert on public.profiles
  for insert to authenticated with check (id = auth.uid());
create policy profiles_update on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- servers: sadece üyeler okur (yazma yalnızca RPC ile)
create policy servers_select on public.servers
  for select to authenticated using (public.is_member(id));

-- server_members: aynı sunucudaki üyeler birbirini görür
create policy members_select on public.server_members
  for select to authenticated using (public.is_member(server_id));

-- channels: üyeler okur, sadece sunucu sahibi ekler/siler
create policy channels_select on public.channels
  for select to authenticated using (public.is_member(server_id));
create policy channels_insert on public.channels
  for insert to authenticated
  with check (exists (select 1 from public.servers s
                      where s.id = server_id and s.owner_id = auth.uid()));
create policy channels_delete on public.channels
  for delete to authenticated
  using (exists (select 1 from public.servers s
                 where s.id = server_id and s.owner_id = auth.uid()));

-- messages: üyeler okur; sadece üye ve kendi adına ekleyebilir
create policy messages_select on public.messages
  for select to authenticated
  using (exists (select 1 from public.channels c
                 where c.id = channel_id and public.is_member(c.server_id)));
create policy messages_insert on public.messages
  for insert to authenticated
  with check (
    author_id = auth.uid()
    and exists (select 1 from public.channels c
                where c.id = channel_id and public.is_member(c.server_id))
  );

-- ========== RPC'LER ==========

-- 8 karakterlik rastgele davet kodu (UUID'nin ilk 8 hex karakteri)
create function public.gen_invite_code()
returns text
language sql
volatile
set search_path = public
as $$
  select substr(replace(gen_random_uuid()::text, '-', ''), 1, 8);
$$;

-- Sunucu kur: sunucu + sahip üyeliği + #genel ve Lobi kanalları
create function public.create_server(name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  sid uuid;
begin
  if auth.uid() is null then
    raise exception 'Giriş yapmalısın';
  end if;

  insert into public.servers (name, owner_id, invite_code)
  values (name, auth.uid(), public.gen_invite_code())
  returning id into sid;

  insert into public.server_members (server_id, user_id) values (sid, auth.uid());

  insert into public.channels (server_id, name, kind, position) values
    (sid, 'genel', 'text', 0),
    (sid, '🔊 Lobi', 'voice', 1);

  return sid;
end;
$$;

-- Davet koduyla katıl: sunucu id'sini döner
create function public.join_server_by_invite(code text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  sid uuid;
begin
  if auth.uid() is null then
    raise exception 'Giriş yapmalısın';
  end if;

  select id into sid from public.servers where invite_code = code;
  if sid is null then
    raise exception 'Geçersiz davet kodu';
  end if;

  insert into public.server_members (server_id, user_id)
  values (sid, auth.uid())
  on conflict do nothing;

  return sid;
end;
$$;

revoke all on function public.create_server(text) from public, anon;
revoke all on function public.join_server_by_invite(text) from public, anon;
grant execute on function public.create_server(text) to authenticated;
grant execute on function public.join_server_by_invite(text) to authenticated;

-- ========== REALTIME ==========
alter publication supabase_realtime add table public.messages;

-- ========== AVATAR DEPOSU ==========
-- Herkes okuyabilir; kullanıcı yalnızca kendi "<uid>.webp" dosyasını yazar.
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

create policy avatars_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'avatars' and name = auth.uid()::text || '.webp');
create policy avatars_select on storage.objects
  for select to authenticated
  using (bucket_id = 'avatars' and name = auth.uid()::text || '.webp');
create policy avatars_update on storage.objects
  for update to authenticated
  using (bucket_id = 'avatars' and name = auth.uid()::text || '.webp')
  with check (bucket_id = 'avatars' and name = auth.uid()::text || '.webp');
