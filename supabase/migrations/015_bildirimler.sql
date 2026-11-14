-- 015: Bildirimler (v0.13.0). Sunucu ve kanal bildirim düzeyi, kanalı (süreli) sessize alma, "Tümünü okundu say".
-- Ayrıntı: docs/superpowers/specs/2026-11-14-voxen-bildirimler-design.md
-- Bu dosyada:
--  1) server_notify_levels: sunucu başına bildirim düzeyim ('all' | 'mentions' | 'none'). Satır yoksa 'mentions'.
--  2) channel_notify_prefs: kanal başına düzeyim (null = sunucu varsayılanı) ve sessize alma
--     (muted + muted_until: null ise "ben açana kadar", dolu ise o ana kadar; süre dolunca istemci
--     sessizliği kalkmış sayar, sunucuda iş yok).
--     İki tablo da server_mutes (007) kalıbında: yalnız kendi satırların; yazarken sunucunun üyesi olmalısın.
--  3) mark_server_read(sid): sunucudaki bütün yazılı kanalları en son mesajlarına kadar okundu yazar
--     (mark_read gibi yalnız ileri gider).
--
-- Bildirimin kendisi için sunucu tarafında iş yok: istemci yeni mesajları zaten tek messages aboneliğiyle
-- (postgres_changes, RLS süzer: yalnız kanalı okuyabilen sunucu üyesi alır) alıyor; yeni realtime konusu yok.
-- Bire bir DM'i sessize alma 011'deki dm_mutes ile yapılır (RLS bire biri zaten kabul ediyor); burada değişiklik yok.
--
-- Hata kodları: NOT_ALLOWED (zaten var). Üye olmayan ile var olmayan sunucu aynı kodu alır (bilgi sızmaz).
-- Uyumluluk (v0.12.0): yalnız yeni tablolar ve yeni bir RPC. Var olan tablo/sütun/RPC değişmez.
-- v0.12.0 istemcisi yeni tabloları bilmez; eski davranışla (yalnız bahsetmeler) devam eder.

-- ========== 1) SUNUCU BİLDİRİM DÜZEYİ ==========

create table if not exists public.server_notify_levels (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  server_id uuid not null references public.servers(id) on delete cascade,
  level text not null check (level in ('all', 'mentions', 'none')),
  primary key (user_id, server_id)
);

create index if not exists server_notify_levels_server_idx on public.server_notify_levels (server_id);

alter table public.server_notify_levels enable row level security;

-- Yalnız kendi satırların. Eklerken ve değiştirirken sunucunun üyesi olmalısın.
drop policy if exists server_notify_levels_select on public.server_notify_levels;
create policy server_notify_levels_select on public.server_notify_levels
  for select to authenticated
  using (user_id = auth.uid());
drop policy if exists server_notify_levels_insert on public.server_notify_levels;
create policy server_notify_levels_insert on public.server_notify_levels
  for insert to authenticated
  with check (user_id = auth.uid() and public.is_member(server_id));
drop policy if exists server_notify_levels_update on public.server_notify_levels;
create policy server_notify_levels_update on public.server_notify_levels
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and public.is_member(server_id));
drop policy if exists server_notify_levels_delete on public.server_notify_levels;
create policy server_notify_levels_delete on public.server_notify_levels
  for delete to authenticated
  using (user_id = auth.uid());

-- ========== 2) KANAL BİLDİRİM DÜZEYİ VE SESSİZE ALMA ==========

create table if not exists public.channel_notify_prefs (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  channel_id uuid not null references public.channels(id) on delete cascade,
  level text check (level is null or level in ('all', 'mentions', 'none')),
  muted boolean not null default false,
  muted_until timestamptz,
  primary key (user_id, channel_id),
  -- Süre yalnız sessizken anlamlı
  constraint channel_notify_prefs_until check (muted or muted_until is null)
);

create index if not exists channel_notify_prefs_channel_idx on public.channel_notify_prefs (channel_id);

alter table public.channel_notify_prefs enable row level security;

-- Yalnız kendi satırların. Eklerken ve değiştirirken kanal yazılı olmalı ve sunucusunun üyesi olmalısın.
drop policy if exists channel_notify_prefs_select on public.channel_notify_prefs;
create policy channel_notify_prefs_select on public.channel_notify_prefs
  for select to authenticated
  using (user_id = auth.uid());
drop policy if exists channel_notify_prefs_insert on public.channel_notify_prefs;
create policy channel_notify_prefs_insert on public.channel_notify_prefs
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (select 1 from public.channels c
                where c.id = channel_id and c.kind = 'text' and public.is_member(c.server_id))
  );
drop policy if exists channel_notify_prefs_update on public.channel_notify_prefs;
create policy channel_notify_prefs_update on public.channel_notify_prefs
  for update to authenticated
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and exists (select 1 from public.channels c
                where c.id = channel_id and c.kind = 'text' and public.is_member(c.server_id))
  );
drop policy if exists channel_notify_prefs_delete on public.channel_notify_prefs;
create policy channel_notify_prefs_delete on public.channel_notify_prefs
  for delete to authenticated
  using (user_id = auth.uid());

-- ========== 3) TÜMÜNÜ OKUNDU SAY ==========

-- Sunucudaki bütün yazılı kanallar, her birinin en son mesajına kadar okundu (mark_read kuralı: yalnız ileri).
-- Mesajı olmayan kanal 0 ile yazılır. Dönen: gerçekten değişen (eklenen ya da ilerleyen) kanal sayısı.
create or replace function public.mark_server_read(sid uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  sayi int;
begin
  if auth.uid() is null or sid is null or not public.is_member(sid) then
    raise exception 'NOT_ALLOWED';
  end if;

  insert into public.channel_reads as r (user_id, channel_id, last_read_id)
  select auth.uid(), c.id,
         coalesce((select max(m.id) from public.messages m where m.channel_id = c.id), 0)
    from public.channels c
   where c.server_id = sid and c.kind = 'text'
  on conflict (user_id, channel_id)
  do update set last_read_id = excluded.last_read_id
  -- Yalnız gerçekten ilerleyen satır yazılır (değişmeyen satır için boş UPDATE/WAL yok)
  where excluded.last_read_id > r.last_read_id;

  get diagnostics sayi = row_count;
  return sayi;
end;
$$;

revoke all on function public.mark_server_read(uuid) from public, anon;
grant execute on function public.mark_server_read(uuid) to authenticated;
