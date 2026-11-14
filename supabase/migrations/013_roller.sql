-- 013: Sunucu rolleri ve izinler (v0.11.0).
-- Bu dosyada:
--  1) roles ve member_roles tabloları (RLS: yalnız üyeler okur; yazma yalnız RPC)
--  2) Her sunucuda gizli varsayılan "@herkes" rolü (geriye dönük doldurma + yeni sunucuda tetikleyici)
--  3) TEK yetki fonksiyonu: has_permission(sid, uid, perm). Sahip her izne sahiptir.
--  4) Bugün sahibe bağlı her kural bu fonksiyona taşınır (liste: docs/superpowers/specs/2026-11-14-voxen-roller-design.md):
--     channels_insert, delete_channel, rename_channel, delete_message, can_pin, ek_silinebilir, rename_server.
--     delete_server ve leave_server yalnız sahibe bağlı kalır (izin tablosunda yok; bu dosyada yeniden tanımlanmaz).
--  5) Rol RPC'leri (oluştur, düzenle, sil, taşı, ata) ve hiyerarşi; kick_member, regenerate_invite, move_channel
--  6) @herkes bahsetmesi: mentions_everyone + unread_counts (MENTION_EVERYONE izni)
--  7) Canlı güncelleme: roles/member_roles değişince "server:<sid>" konusuna "roller" olayı
--
-- Hata kodları (istemci src/data/roles.js Türkçeye çevirir): NOT_ALLOWED, ROLE_HIERARCHY, PERMISSION_NOT_HELD,
-- DEFAULT_ROLE, ROLE_LIMIT, ROLE_NAME, ROLE_COLOR, BAD_PERMISSION.
-- Yükseltme engeli (sahip olmayan için):
--  - Kendi en yüksek rolüne eşit ya da üstündeki rolü düzenleyemez, silemez, taşıyamaz, atayamaz.
--  - En yüksek rolü kendininkine eşit ya da üstünde olan kişinin rollerini değiştiremez, onu çıkaramaz (sahip dahil).
--  - Kendinde olmayan izni hiçbir role (@herkes dahil) veremez/alamaz; böyle izin taşıyan rolü kimseye atayamaz.
--
-- Uyumluluk (v0.10.0):
--  - Yeni tablolar; var olan tablo/sütun silinmez, yeniden adlandırılmaz.
--  - Var olan RPC'lerin imzası ve dönüşü aynı (create or replace). unread_counts aynı sütunları döner.
--  - Sahip için davranış aynı. Eski istemci "roller" olayını dinlemez.
--  - member_roles'ün profiles/auth.users'a doğrudan FK'si yok: mevcut PostgREST gömmeleri belirsizleşmez.

-- ========== 1) TABLOLAR ==========

create table if not exists public.roles (
  id uuid primary key default gen_random_uuid(),
  server_id uuid not null references public.servers(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 30),
  -- 8 hazır tema rengi (istemci var(--rol-<anahtar>) kullanır) ya da renksiz
  color text check (color is null or color in ('kirmizi', 'turuncu', 'sari', 'yesil', 'turkuaz', 'mavi', 'mor', 'pembe')),
  position int not null default 1,
  permissions text[] not null default '{}'
    check (permissions <@ array['MANAGE_CHANNELS', 'MANAGE_MESSAGES', 'KICK_MEMBERS', 'MANAGE_ROLES', 'MANAGE_SERVER', 'MENTION_EVERYONE']::text[]),
  is_default boolean not null default false,
  hoist boolean not null default false, -- "Üyeleri ayrı göster"
  created_at timestamptz not null default now(),
  -- @herkes en altta (0); diğer roller 1..n
  constraint roles_sira check ((is_default and position = 0) or (not is_default and position >= 1)),
  -- member_roles'ün (server_id, role_id) FK'si için: rol başka sunucuya atanamaz
  constraint roles_sunucu_id unique (server_id, id)
);

-- Sunucu başına tek @herkes
create unique index if not exists roles_tek_varsayilan on public.roles (server_id) where is_default;
create index if not exists roles_server_idx on public.roles (server_id, position);

create table if not exists public.member_roles (
  server_id uuid not null,
  user_id uuid not null,
  role_id uuid not null,
  primary key (server_id, user_id, role_id),
  -- Üyelik silinince (ayrılma, çıkarılma, sunucu silme) rolleri de gider
  constraint member_roles_uye foreign key (server_id, user_id)
    references public.server_members (server_id, user_id) on delete cascade,
  constraint member_roles_rol foreign key (server_id, role_id)
    references public.roles (server_id, id) on delete cascade
);

create index if not exists member_roles_role_idx on public.member_roles (role_id);

alter table public.roles enable row level security;
alter table public.member_roles enable row level security;

-- Okuma: o sunucunun üyeleri. Yazma politikası yok: yalnız RPC.
drop policy if exists roles_select on public.roles;
create policy roles_select on public.roles
  for select to authenticated
  using (public.is_member(server_id));

drop policy if exists member_roles_select on public.member_roles;
create policy member_roles_select on public.member_roles
  for select to authenticated
  using (public.is_member(server_id));

-- ========== 2) VARSAYILAN @herkes ROLÜ ==========

-- Yeni sunucu (create_server) kurulunca @herkes rolü eklenir
create or replace function public.varsayilan_rol_kur()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.roles (server_id, name, color, position, permissions, is_default)
  values (new.id, '@herkes', null, 0, '{}', true)
  on conflict do nothing;
  return null;
end;
$$;

revoke all on function public.varsayilan_rol_kur() from public, anon;
grant execute on function public.varsayilan_rol_kur() to authenticated;

drop trigger if exists servers_varsayilan_rol on public.servers;
create trigger servers_varsayilan_rol
  after insert on public.servers
  for each row execute function public.varsayilan_rol_kur();

-- Geriye dönük: var olan her sunucuya @herkes (izinsiz: bugünkü davranışla aynı)
insert into public.roles (server_id, name, color, position, permissions, is_default)
select s.id, '@herkes', null, 0, '{}', true
  from public.servers s
 where not exists (select 1 from public.roles r where r.server_id = s.id and r.is_default);

-- ========== 3) YETKİ FONKSİYONLARI ==========

-- Bütün izin adları (tek liste; istemcideki src/data/rolKurallari.js IZINLER ile AYNI sıra)
create or replace function public.izin_adlari()
returns text[]
language sql
immutable
security definer
set search_path = public
as $$
  select array['MANAGE_CHANNELS', 'MANAGE_MESSAGES', 'KICK_MEMBERS', 'MANAGE_ROLES', 'MANAGE_SERVER', 'MENTION_EVERYONE']::text[];
$$;

-- TEK MERKEZ: uid, sid sunucusunda perm iznine sahip mi?
--  - Sahip: her zaman evet.
--  - Değilse üye olmalı ve @herkes ya da atanmış rollerinden biri perm'i taşımalı.
--  - Çağıran başkasını soruyorsa o sunucunun üyesi olmalı (yabancı sunucu hakkında bilgi sızmaz).
--  - Sonuç hiçbir zaman null değildir ("if not has_permission(...)" null ile yanlışlıkla geçmesin).
create or replace function public.has_permission(sid uuid, uid uuid, perm text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if sid is null or uid is null or perm is null or auth.uid() is null then
    return false;
  end if;
  if uid <> auth.uid() and not public.is_member(sid) then
    return false;
  end if;
  if exists (select 1 from public.servers s where s.id = sid and s.owner_id = uid) then
    return true;
  end if;
  if not exists (select 1 from public.server_members m where m.server_id = sid and m.user_id = uid) then
    return false;
  end if;
  return exists (
    select 1 from public.roles r
     where r.server_id = sid
       and perm = any (r.permissions)
       and (r.is_default
            or exists (select 1 from public.member_roles mr
                        where mr.server_id = sid and mr.user_id = uid and mr.role_id = r.id))
  );
end;
$$;

revoke all on function public.izin_adlari() from public, anon;
grant execute on function public.izin_adlari() to authenticated;
revoke all on function public.has_permission(uuid, uuid, text) from public, anon;
grant execute on function public.has_permission(uuid, uuid, text) to authenticated;

-- Kişinin o sunucudaki bütün izinleri (sahip: hepsi; üye değil: boş). Yalnız veritabanı içinde.
create or replace function public.kisi_izinleri(sid uuid, uid uuid)
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  select case
    when exists (select 1 from public.servers s where s.id = sid and s.owner_id = uid) then public.izin_adlari()
    when not exists (select 1 from public.server_members m where m.server_id = sid and m.user_id = uid) then '{}'::text[]
    else coalesce((
      select array_agg(distinct p order by p)
        from public.roles r
        cross join lateral unnest(r.permissions) as p
       where r.server_id = sid
         and (r.is_default
              or exists (select 1 from public.member_roles mr
                          where mr.server_id = sid and mr.user_id = uid and mr.role_id = r.id))
    ), '{}'::text[])
  end;
$$;

-- Kişinin en yüksek rol sırası: sahip en üstte (2147483647), üye değilse -1, rolü yoksa 0 (@herkes).
-- Yalnız veritabanı içinde.
create or replace function public.uye_ust_sira(sid uuid, uid uuid)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select case
    when exists (select 1 from public.servers s where s.id = sid and s.owner_id = uid) then 2147483647
    when not exists (select 1 from public.server_members m where m.server_id = sid and m.user_id = uid) then -1
    else coalesce((
      select max(r.position)
        from public.member_roles mr
        join public.roles r on r.id = mr.role_id
       where mr.server_id = sid and mr.user_id = uid
    ), 0)
  end;
$$;

revoke all on function public.kisi_izinleri(uuid, uuid) from public, anon, authenticated;
revoke all on function public.uye_ust_sira(uuid, uuid) from public, anon, authenticated;

-- ========== 4) SAHİBE BAĞLI KURALLAR → has_permission ==========

-- 4a) Kanal ekleme (eski istemci doğrudan INSERT yapar; politika artık izne bakar)
drop policy if exists channels_insert on public.channels;
create policy channels_insert on public.channels
  for insert to authenticated
  with check (public.has_permission(server_id, auth.uid(), 'MANAGE_CHANNELS'));

-- 4b) Mesajı siler (yumuşak): yazarı ya da MANAGE_MESSAGES izni olan (006'nın aynısı; yalnız yetki değişti)
create or replace function public.delete_message(id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  m public.messages;
  sid uuid;
begin
  if auth.uid() is null then
    raise exception 'Giriş yapmalısın';
  end if;

  select * into m from public.messages where messages.id = delete_message.id for update;
  select c.server_id into sid from public.channels c where c.id = m.channel_id;
  if m.id is null or m.deleted_at is not null or sid is null or not public.is_member(sid) then
    raise exception 'Mesaj bulunamadı';
  end if;
  if m.author_id <> auth.uid()
     and not public.has_permission(sid, auth.uid(), 'MANAGE_MESSAGES') then
    raise exception 'Bu mesajı silemezsin';
  end if;

  update public.messages
     set content = '', deleted_at = now()
   where messages.id = delete_message.id;
end;
$$;

-- 4c) Sunucu adını değiştir (MANAGE_SERVER), 1–40 karakter
create or replace function public.rename_server(sid uuid, ad text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  yeni_ad text := btrim(coalesce(ad, ''));
begin
  if auth.uid() is null then
    raise exception 'Giriş yapmalısın';
  end if;
  if not public.is_member(sid) then
    raise exception 'Sunucu bulunamadı';
  end if;
  if not public.has_permission(sid, auth.uid(), 'MANAGE_SERVER') then
    raise exception 'Bunu yapmaya yetkin yok.';
  end if;
  if char_length(yeni_ad) not between 1 and 40 then
    raise exception 'Sunucu adı 1–40 karakter olmalı';
  end if;

  update public.servers set name = yeni_ad where id = sid;
end;
$$;

-- 4d) Kanalı sil (MANAGE_CHANNELS). Son yazılı kanal kuralı ve kilit 006'daki gibi.
create or replace function public.delete_channel(cid uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  sid uuid;
  tur text;
begin
  if auth.uid() is null then
    raise exception 'Giriş yapmalısın';
  end if;

  select c.server_id into sid from public.channels c where c.id = cid;
  if sid is null or not public.is_member(sid) then
    raise exception 'Kanal bulunamadı';
  end if;
  if not public.has_permission(sid, auth.uid(), 'MANAGE_CHANNELS') then
    raise exception 'Bunu yapmaya yetkin yok.';
  end if;

  -- Sunucu satırını kilitle (yarış bu satırda sıraya girer)
  perform 1 from public.servers s where s.id = sid for update;
  if not found then
    raise exception 'Kanal bulunamadı';
  end if;

  select c.kind into tur from public.channels c where c.id = cid;
  if tur is null then
    raise exception 'Kanal bulunamadı';
  end if;
  if tur = 'text'
     and (select count(*) from public.channels c where c.server_id = sid and c.kind = 'text') <= 1 then
    raise exception 'Sunucuda en az bir yazılı kanal kalmalı.';
  end if;

  delete from public.channels where id = cid;
end;
$$;

-- 4e) Kanalı yeniden adlandır (MANAGE_CHANNELS), 1–30 karakter
create or replace function public.rename_channel(cid uuid, ad text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  sid uuid;
  yeni_ad text := btrim(coalesce(ad, ''));
begin
  if auth.uid() is null then
    raise exception 'Giriş yapmalısın';
  end if;

  select c.server_id into sid from public.channels c where c.id = cid;
  if sid is null or not public.is_member(sid) then
    raise exception 'Kanal bulunamadı';
  end if;
  if not public.has_permission(sid, auth.uid(), 'MANAGE_CHANNELS') then
    raise exception 'Bunu yapmaya yetkin yok.';
  end if;
  if char_length(yeni_ad) not between 1 and 30 then
    raise exception 'Kanal adı 1–30 karakter olmalı';
  end if;

  update public.channels set name = yeni_ad where id = cid;
end;
$$;

-- 4f) Kanalda sabitleme yetkisi (009'daki TEK yer): MANAGE_MESSAGES
create or replace function public.can_pin(cid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.channels c
     where c.id = cid
       and public.is_member(c.server_id)
       and public.has_permission(c.server_id, auth.uid(), 'MANAGE_MESSAGES')
  );
$$;

-- 4g) Bu ek yolunu silebilir miyim? (010'un aynısı; "sunucu sahibi" yerine MANAGE_MESSAGES)
--  - Kendi klasörüm: evet.
--  - k: kanalın sunucusunda MANAGE_MESSAGES iznim var ve nesne hiçbir mesaja bağlı değil.
create or replace function public.ek_silinebilir(yol text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  p text[] := storage.foldername(yol);
begin
  if auth.uid() is null or p is null or coalesce(array_length(p, 1), 0) <> 3 then
    return false;
  end if;
  if p[3] = auth.uid()::text then
    return true;
  end if;
  if p[1] <> 'k' or p[2] !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;
  return exists (select 1 from public.channels c
                  where c.id = p[2]::uuid
                    and public.has_permission(c.server_id, auth.uid(), 'MANAGE_MESSAGES'))
     and not exists (select 1 from public.attachments a where a.path = yol);
end;
$$;

revoke all on function public.delete_message(bigint) from public, anon;
revoke all on function public.rename_server(uuid, text) from public, anon;
revoke all on function public.delete_channel(uuid) from public, anon;
revoke all on function public.rename_channel(uuid, text) from public, anon;
revoke all on function public.can_pin(uuid) from public, anon;
revoke all on function public.ek_silinebilir(text) from public, anon;
grant execute on function public.delete_message(bigint) to authenticated;
grant execute on function public.rename_server(uuid, text) to authenticated;
grant execute on function public.delete_channel(uuid) to authenticated;
grant execute on function public.rename_channel(uuid, text) to authenticated;
grant execute on function public.can_pin(uuid) to authenticated;
grant execute on function public.ek_silinebilir(text) to authenticated;

-- ========== 5) ROL RPC'LERİ ==========

-- Ortak yardımcılar (yalnız veritabanı içinde)

-- Renk geçerli mi (null = renksiz)
create or replace function public.rol_rengi_gecerli(renk text)
returns boolean
language sql
immutable
security definer
set search_path = public
as $$
  select renk is null or renk in ('kirmizi', 'turuncu', 'sari', 'yesil', 'turkuaz', 'mavi', 'mor', 'pembe');
$$;

-- İzin dizisini denetler: tekrarları atar, sıralar; bilinmeyen izin varsa BAD_PERMISSION
create or replace function public.izin_dizisi(izinler text[])
returns text[]
language plpgsql
immutable
security definer
set search_path = public
as $$
declare
  dizi text[];
begin
  select coalesce(array_agg(distinct p order by p), '{}'::text[])
    into dizi
    from unnest(coalesce(izinler, '{}'::text[])) as p;
  if array_position(dizi, null) is not null or not (dizi <@ public.izin_adlari()) then
    raise exception 'BAD_PERMISSION';
  end if;
  return dizi;
end;
$$;

-- Rol yöneticisi denetimi: çağıran üye ve MANAGE_ROLES sahibi olmalı (değilse NOT_ALLOWED).
-- Döner: çağıranın en yüksek rol sırası (sahip: 2147483647).
create or replace function public.rol_yoneticisi(sid uuid)
returns int
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or sid is null or not public.is_member(sid)
     or not public.has_permission(sid, auth.uid(), 'MANAGE_ROLES') then
    raise exception 'NOT_ALLOWED';
  end if;
  return public.uye_ust_sira(sid, auth.uid());
end;
$$;

-- @herkes dışındaki rolleri 1..n'ye yeniden numaralar (sıra korunur). Değişmeyen satıra dokunmaz.
create or replace function public.rolleri_sirala(sid uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.roles r
     set position = x.sira
    from (select y.id, row_number() over (order by y.position, y.created_at, y.id)::int as sira
            from public.roles y
           where y.server_id = sid and not y.is_default) x
   where r.id = x.id and r.position <> x.sira;
$$;

-- Rol işlemleri sunucu başına sıraya girer (sıra numaraları yarışta bozulmasın)
create or replace function public.rol_kilidi(sid uuid)
returns void
language sql
security definer
set search_path = public
as $$
  select pg_advisory_xact_lock(hashtextextended('roller:' || sid::text, 0));
$$;

revoke all on function public.rol_rengi_gecerli(text) from public, anon, authenticated;
revoke all on function public.izin_dizisi(text[]) from public, anon, authenticated;
revoke all on function public.rol_yoneticisi(uuid) from public, anon, authenticated;
revoke all on function public.rolleri_sirala(uuid) from public, anon, authenticated;
revoke all on function public.rol_kilidi(uuid) from public, anon, authenticated;

-- Rol oluşturur: @herkes'in hemen üstüne (sıra 1) eklenir, diğerleri bir yukarı kayar.
-- Sahip olmayan, kendinde olmayan izni veremez. Sunucu başına en fazla 50 rol (@herkes hariç).
create or replace function public.create_role(sid uuid, ad text, renk text, izinler text[])
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  ben uuid := auth.uid();
  yeni_ad text := btrim(coalesce(ad, ''));
  dizi text[];
  yeni uuid;
begin
  if ben is null or sid is null then
    raise exception 'NOT_ALLOWED';
  end if;
  perform public.rol_kilidi(sid);
  perform public.rol_yoneticisi(sid);
  if char_length(yeni_ad) not between 1 and 30 then
    raise exception 'ROLE_NAME';
  end if;
  if not public.rol_rengi_gecerli(renk) then
    raise exception 'ROLE_COLOR';
  end if;
  dizi := public.izin_dizisi(izinler);
  if not (dizi <@ public.kisi_izinleri(sid, ben)) then
    raise exception 'PERMISSION_NOT_HELD';
  end if;
  if (select count(*) from public.roles r where r.server_id = sid and not r.is_default) >= 50 then
    raise exception 'ROLE_LIMIT';
  end if;

  update public.roles r set position = r.position + 1 where r.server_id = sid and not r.is_default;
  insert into public.roles (server_id, name, color, position, permissions)
  values (sid, yeni_ad, renk, 1, dizi)
  returning id into yeni;
  return yeni;
end;
$$;

-- Rolü düzenler: ad, renk, izinler, "ayrı göster". @herkes'te yalnız izinler değişir.
-- Sahip olmayan: kendi en yüksek rolüne eşit/üstündeki rolü düzenleyemez (@herkes hariç: hep en altta);
-- eklenen ya da çıkarılan her izin kendinde olmalı.
create or replace function public.update_role(rid uuid, ad text, renk text, izinler text[], ayri boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  ben uuid := auth.uid();
  r public.roles;
  ust int;
  yeni_ad text := btrim(coalesce(ad, ''));
  dizi text[];
  fark text[];
begin
  if ben is null or rid is null then
    raise exception 'NOT_ALLOWED';
  end if;
  select * into r from public.roles x where x.id = rid;
  if not found then
    raise exception 'NOT_ALLOWED';
  end if;
  perform public.rol_kilidi(r.server_id);
  select * into r from public.roles x where x.id = rid for update;
  if not found then
    raise exception 'NOT_ALLOWED';
  end if;
  ust := public.rol_yoneticisi(r.server_id);
  if not r.is_default and r.position >= ust then
    raise exception 'ROLE_HIERARCHY';
  end if;

  dizi := public.izin_dizisi(izinler);
  -- Değişen izinler (eklenen ya da çıkarılan): hepsi çağıranda olmalı
  select coalesce(array_agg(p), '{}'::text[]) into fark
    from ((select unnest(dizi) except select unnest(r.permissions))
          union
          (select unnest(r.permissions) except select unnest(dizi))) as d(p);
  if not (fark <@ public.kisi_izinleri(r.server_id, ben)) then
    raise exception 'PERMISSION_NOT_HELD';
  end if;

  if r.is_default then
    update public.roles x set permissions = dizi where x.id = rid;
    return;
  end if;

  if char_length(yeni_ad) not between 1 and 30 then
    raise exception 'ROLE_NAME';
  end if;
  if not public.rol_rengi_gecerli(renk) then
    raise exception 'ROLE_COLOR';
  end if;
  update public.roles x
     set name = yeni_ad, color = renk, permissions = dizi, hoist = coalesce(ayri, r.hoist)
   where x.id = rid;
end;
$$;

-- Rolü siler (atamaları cascade ile gider), sonra sıraları yeniden numaralar. @herkes silinemez.
create or replace function public.delete_role(rid uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.roles;
  ust int;
begin
  if auth.uid() is null or rid is null then
    raise exception 'NOT_ALLOWED';
  end if;
  select * into r from public.roles x where x.id = rid;
  if not found then
    raise exception 'NOT_ALLOWED';
  end if;
  perform public.rol_kilidi(r.server_id);
  select * into r from public.roles x where x.id = rid for update;
  if not found then
    raise exception 'NOT_ALLOWED';
  end if;
  ust := public.rol_yoneticisi(r.server_id);
  if r.is_default then
    raise exception 'DEFAULT_ROLE';
  end if;
  if r.position >= ust then
    raise exception 'ROLE_HIERARCHY';
  end if;

  delete from public.roles x where x.id = rid;
  perform public.rolleri_sirala(r.server_id);
end;
$$;

-- Rolü hedef sıraya taşır (1 = @herkes'in hemen üstü, n = en üst; dışındaysa kırpılır).
-- Sahip olmayan: rolün şimdiki ve hedef sırası kendi en yüksek rolünün altında olmalı.
-- Sıralar bitişik (1..n) olduğundan yalnız aradaki roller kayar; üstteki roller yerinde kalır.
create or replace function public.move_role(rid uuid, hedef int)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.roles;
  ust int;
  n int;
  h int;
  ids uuid[];
begin
  if auth.uid() is null or rid is null then
    raise exception 'NOT_ALLOWED';
  end if;
  select * into r from public.roles x where x.id = rid;
  if not found then
    raise exception 'NOT_ALLOWED';
  end if;
  perform public.rol_kilidi(r.server_id);
  perform public.rol_yoneticisi(r.server_id); -- önce yetki: yetkisiz çağrı hiçbir satıra dokunmaz
  perform public.rolleri_sirala(r.server_id); -- güvenlik: sıralar bitişik olsun
  select * into r from public.roles x where x.id = rid;
  if not found then
    raise exception 'NOT_ALLOWED';
  end if;
  ust := public.uye_ust_sira(r.server_id, auth.uid());
  if r.is_default then
    raise exception 'DEFAULT_ROLE';
  end if;
  select count(*)::int into n from public.roles x where x.server_id = r.server_id and not x.is_default;
  h := greatest(1, least(n, coalesce(hedef, r.position)));
  if r.position >= ust or h >= ust then
    raise exception 'ROLE_HIERARCHY';
  end if;
  if h = r.position then
    return;
  end if;

  select coalesce(array_agg(x.id order by x.position, x.created_at, x.id), '{}'::uuid[]) into ids
    from public.roles x
   where x.server_id = r.server_id and not x.is_default and x.id <> rid;
  ids := ids[1:h - 1] || rid || ids[h:n];
  update public.roles x
     set position = s.sira::int
    from unnest(ids) with ordinality as s(rol, sira)
   where x.id = s.rol and x.position <> s.sira;
end;
$$;

-- Üyeye rol verir (ver = true) ya da alır (false). Tekrarlanabilir.
-- Sahip olmayan: rol kendi en yüksek rolünün altında olmalı; başkasıysa kişinin en yüksek rolü de
-- kendininkinin altında olmalı (sahibin rolleri değiştirilemez); verirken rolün her izni kendinde olmalı.
create or replace function public.set_member_role(sid uuid, uid uuid, rid uuid, ver boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  ben uuid := auth.uid();
  r public.roles;
  ust int;
begin
  if ben is null or sid is null or uid is null or rid is null or ver is null then
    raise exception 'NOT_ALLOWED';
  end if;
  perform public.rol_kilidi(sid);
  ust := public.rol_yoneticisi(sid);
  select * into r from public.roles x where x.id = rid and x.server_id = sid;
  if not found then
    raise exception 'NOT_ALLOWED';
  end if;
  if not exists (select 1 from public.server_members m where m.server_id = sid and m.user_id = uid) then
    raise exception 'NOT_ALLOWED';
  end if;
  if r.is_default then
    raise exception 'DEFAULT_ROLE';
  end if;
  if r.position >= ust then
    raise exception 'ROLE_HIERARCHY';
  end if;
  if uid <> ben and public.uye_ust_sira(sid, uid) >= ust then
    raise exception 'ROLE_HIERARCHY';
  end if;

  if ver then
    if not (r.permissions <@ public.kisi_izinleri(sid, ben)) then
      raise exception 'PERMISSION_NOT_HELD';
    end if;
    insert into public.member_roles (server_id, user_id, role_id)
    values (sid, uid, rid)
    on conflict do nothing;
  else
    delete from public.member_roles mr
     where mr.server_id = sid and mr.user_id = uid and mr.role_id = rid;
  end if;
end;
$$;

revoke all on function public.create_role(uuid, text, text, text[]) from public, anon;
revoke all on function public.update_role(uuid, text, text, text[], boolean) from public, anon;
revoke all on function public.delete_role(uuid) from public, anon;
revoke all on function public.move_role(uuid, int) from public, anon;
revoke all on function public.set_member_role(uuid, uuid, uuid, boolean) from public, anon;
grant execute on function public.create_role(uuid, text, text, text[]) to authenticated;
grant execute on function public.update_role(uuid, text, text, text[], boolean) to authenticated;
grant execute on function public.delete_role(uuid) to authenticated;
grant execute on function public.move_role(uuid, int) to authenticated;
grant execute on function public.set_member_role(uuid, uuid, uuid, boolean) to authenticated;

-- ========== 6) ÜYE ÇIKARMA, DAVET KODU, KANAL SIRASI ==========

-- Üyeyi sunucudan çıkarır (KICK_MEMBERS). Kendini çıkaramaz (leave_server var).
-- Çıkarılanın en yüksek rolü çağıranınkinin altında olmalı (sahip çıkarılamaz).
-- leave_server gibi: o sunucudaki ses durumu ve okundu kayıtları da silinir; rolleri cascade ile gider.
-- Silmeden önce "roller" olayı { tablo: 'kick', user_id }: çıkarılan kişi nedenini bilsin.
create or replace function public.kick_member(sid uuid, uid uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  ben uuid := auth.uid();
begin
  if ben is null or sid is null or uid is null or not public.is_member(sid)
     or not public.has_permission(sid, ben, 'KICK_MEMBERS') then
    raise exception 'NOT_ALLOWED';
  end if;
  perform public.rol_kilidi(sid);
  if uid = ben
     or not exists (select 1 from public.server_members m where m.server_id = sid and m.user_id = uid) then
    raise exception 'NOT_ALLOWED';
  end if;
  if public.uye_ust_sira(sid, uid) >= public.uye_ust_sira(sid, ben) then
    raise exception 'ROLE_HIERARCHY';
  end if;

  begin
    perform realtime.send(
      jsonb_build_object('tablo', 'kick', 'islem', 'DELETE', 'server_id', sid, 'user_id', uid),
      'roller',
      'server:' || sid::text,
      true
    );
  exception when others then
    null; -- yayın gitmedi: çıkarma yine de yapılır (006'daki "degisti" olayı da gider)
  end;

  delete from public.voice_states where user_id = uid and server_id = sid;
  delete from public.channel_reads r
   using public.channels c
   where r.channel_id = c.id and c.server_id = sid and r.user_id = uid;
  delete from public.server_members where server_id = sid and user_id = uid;
end;
$$;

-- Davet kodunu yeniler (MANAGE_SERVER); yeni kodu döner. Eski kod artık çalışmaz.
-- servers güncellemesi 006'daki "degisti" olayını gönderir (herkes yeni kodu görür).
create or replace function public.regenerate_invite(sid uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  kod text;
begin
  if auth.uid() is null or sid is null or not public.is_member(sid)
     or not public.has_permission(sid, auth.uid(), 'MANAGE_SERVER') then
    raise exception 'NOT_ALLOWED';
  end if;
  for i in 1..5 loop
    kod := public.gen_invite_code();
    begin
      update public.servers set invite_code = kod where id = sid;
      return kod;
    exception when unique_violation then
      null; -- aynı kod başka sunucuda var: yeniden dene
    end;
  end loop;
  raise exception 'NOT_ALLOWED';
end;
$$;

-- Kanalı aynı türdeki komşusuyla yer değiştirir (yon: -1 yukarı, +1 aşağı; uçtaysa bir şey olmaz).
-- MANAGE_CHANNELS. O türün kanalları 0..k-1 olarak yeniden numaralanır (öbür türe dokunulmaz;
-- istemci listeyi türe göre ayırır). Sunucu satırı kilitlenir (delete_channel ile aynı sıra).
create or replace function public.move_channel(cid uuid, yon int)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  sid uuid;
  tur text;
  ids uuid[];
  i int;
  j int;
  gecici uuid;
begin
  if auth.uid() is null or cid is null or yon is null or yon not in (-1, 1) then
    raise exception 'NOT_ALLOWED';
  end if;
  select c.server_id, c.kind into sid, tur from public.channels c where c.id = cid;
  if sid is null or not public.is_member(sid)
     or not public.has_permission(sid, auth.uid(), 'MANAGE_CHANNELS') then
    raise exception 'NOT_ALLOWED';
  end if;
  perform 1 from public.servers s where s.id = sid for update;

  select array_agg(c.id order by c.position, c.id) into ids
    from public.channels c
   where c.server_id = sid and c.kind = tur;
  i := array_position(ids, cid);
  if i is null then
    raise exception 'NOT_ALLOWED';
  end if;
  j := i + yon;
  if j < 1 or j > array_length(ids, 1) then
    return;
  end if;
  gecici := ids[i];
  ids[i] := ids[j];
  ids[j] := gecici;

  update public.channels c
     set position = (s.sira - 1)::int
    from unnest(ids) with ordinality as s(kanal, sira)
   where c.id = s.kanal and c.position <> s.sira - 1;
end;
$$;

revoke all on function public.kick_member(uuid, uuid) from public, anon;
revoke all on function public.regenerate_invite(uuid) from public, anon;
revoke all on function public.move_channel(uuid, int) from public, anon;
grant execute on function public.kick_member(uuid, uuid) to authenticated;
grant execute on function public.regenerate_invite(uuid) to authenticated;
grant execute on function public.move_channel(uuid, int) to authenticated;

-- ========== 7) @herkes BAHSETMESİ ==========

-- Metin @herkes ya da @everyone diyor mu? Kelime sınırı mentions_user (007) ile AYNI; istemcide
-- src/mentions.js mentionsEveryone aynı kural. immutable: yalnız girdisine bakar.
create or replace function public.mentions_everyone(metin text)
returns boolean
language sql
immutable
security definer
set search_path = public
as $$
  select coalesce(metin ~* '(^|[^[:alnum:]_])@(herkes|everyone)($|[^[:alnum:]_])', false);
$$;

revoke all on function public.mentions_everyone(text) from public, anon;
grant execute on function public.mentions_everyone(text) to authenticated;

-- 007'deki unread_counts; sütunlar AYNI (create or replace, dönüş tipi değişmez).
-- Tek fark: mentions, yazarın o sunucuda MENTION_EVERYONE izni varsa @herkes/@everyone içeren mesajları da sayar.
create or replace function public.unread_counts()
returns table (channel_id uuid, server_id uuid, count int, mentions int)
language sql
stable
security definer
set search_path = public
as $$
  select c.id, c.server_id,
         (select count(*)::int from (
            select 1 from public.messages m
            where m.channel_id = c.id
              and m.id > t.taban
              and m.deleted_at is null
              and m.author_id <> auth.uid()
            limit 100
          ) x),
         (select count(*)::int from (
            select m.content, m.author_id from public.messages m
            where m.channel_id = c.id
              and m.id > t.taban
              and m.deleted_at is null
              and m.author_id <> auth.uid()
            order by m.id desc
            limit 100
          ) y
          where y.content like '%@%'
            and (public.mentions_user(y.content, ben.username)
                 or (public.mentions_everyone(y.content)
                     and public.has_permission(c.server_id, y.author_id, 'MENTION_EVERYONE'))))
  from public.server_members sm
  join public.channels c on c.server_id = sm.server_id and c.kind = 'text'
  left join public.channel_reads r on r.channel_id = c.id and r.user_id = sm.user_id
  left join public.profiles ben on ben.id = sm.user_id
  cross join lateral (
    select coalesce(
             r.last_read_id,
             (select max(m0.id) from public.messages m0
              where m0.channel_id = c.id and m0.created_at <= sm.joined_at),
             0) as taban
  ) t
  where sm.user_id = auth.uid();
$$;

revoke all on function public.unread_counts() from public, anon;
grant execute on function public.unread_counts() to authenticated;

-- ========== 8) CANLI GÜNCELLEME: "roller" OLAYI ==========
-- roles (ekleme/güncelleme/silme) ve member_roles (ekleme/silme) değişince "server:<sid>" konusuna
-- "roller" yayını: { tablo, islem, server_id, role_id, user_id }. Gönderme politikası yok: yalnız veritabanı.
-- Sunucu silinirken (cascade) olay yok; rol silinirken cascade ile giden atamalar ayrıca olay üretmez.
create or replace function public.rol_olayi_gonder()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  satir jsonb;
  sid uuid;
begin
  if tg_op = 'DELETE' then
    satir := to_jsonb(old);
  else
    satir := to_jsonb(new);
  end if;
  sid := (satir ->> 'server_id')::uuid;
  if not exists (select 1 from public.servers s where s.id = sid) then
    return null;
  end if;
  if tg_table_name = 'member_roles' and tg_op = 'DELETE'
     and not exists (select 1 from public.roles r where r.id = (satir ->> 'role_id')::uuid) then
    return null;
  end if;

  begin
    perform realtime.send(
      jsonb_build_object(
        'tablo', tg_table_name,
        'islem', tg_op,
        'server_id', sid,
        'role_id', case when tg_table_name = 'roles' then satir ->> 'id' else satir ->> 'role_id' end,
        'user_id', satir ->> 'user_id'
      ),
      'roller',
      'server:' || sid::text,
      true
    );
  exception when others then
    null; -- yayın gitmedi: işlem yine de tamamlanır (yedek: pencere odağında tazeleme)
  end;
  return null; -- AFTER tetikleyici
end;
$$;

revoke all on function public.rol_olayi_gonder() from public, anon;
grant execute on function public.rol_olayi_gonder() to authenticated;

drop trigger if exists roles_degisti on public.roles;
create trigger roles_degisti
  after insert or update or delete on public.roles
  for each row execute function public.rol_olayi_gonder();

drop trigger if exists member_roles_degisti on public.member_roles;
create trigger member_roles_degisti
  after insert or delete on public.member_roles
  for each row execute function public.rol_olayi_gonder();
