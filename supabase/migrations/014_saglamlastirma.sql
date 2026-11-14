-- 014: Sağlamlaştırma (v0.12.0). Yeni özellik yok; v0.7–v0.11 incelemelerinde kalan küçük bulgular kapanır.
-- Ayrıntı: docs/superpowers/specs/2026-11-14-voxen-saglamlastirma-design.md
-- Bu dosyada:
--  1) reply_ok / dm_reply_ok: çağıran o kanalın sunucusunun üyesi / o konuşmanın tarafı olmalı (v07 K-2).
--     Yabancı, uuid'sini bildiği bir kanalda bir mesajın var olup olmadığını artık öğrenemez.
--  2) kick_member: izin denetimi rol kilidinden SONRA (v11 K4).
--  3) create_role: rolü olmayan (yetkisi yalnız @herkes'ten gelen) sahip olmayan kişi rol oluşturamaz:
--     oluşturduğu rol kendi üstünde kalır, yönetemezdi (v11 K3) -> ROLE_HIERARCHY.
--  4) delete_role / update_role (izin kaldırma): rolü taşıyan ve çağıranla aynı ya da daha yüksek sırada olan
--     bir üye varsa ROLE_HIERARCHY (v11 K2). Sahip her zaman serbest; sahip "taşıyan" olarak sayılmaz
--     (her izne zaten sahip, etkilenmez); çağıranın kendisi sayılmaz. @herkes bu kuralın dışında.
--  5) Moderatörün (MANAGE_MESSAGES) başkasının bağsız dosyası üzerindeki yetkisi daraltılır (v11 K6):
--     yalnız silinmiş bir kanal mesajının (son 1 gün) dosyaları okunur/silinir. Henüz gönderilmemiş (hiçbir
--     mesaja bağlanmamış) dosyalar artık moderatöre açık değil. Bunun için ek_silinenler tablosu: kanal mesajı
--     yumuşak silinince eklerinin yolları buraya yazılır.
--  6) Grup kurucusunun hesabı silinirse (owner_id -> null) kuruculuk en eski üyeye geçer (v09 K5);
--     sahipsiz kalmış eski gruplar da bir kez onarılır. Kalan üyelere "degisti" olayı gider.
--  7) Sunucuya biri katılınca da "degisti" { tablo: 'server_members', islem: 'INSERT' } yayınlanır (v12 KR1):
--     sesli kanaldaki üyeler izin listelerini tazeler, yeni üyeyle bağlantı kurulur. 006'da yalnız silme vardı.
--
-- Hata kodları: yeni kod yok (ROLE_HIERARCHY, NOT_ALLOWED zaten var).
-- Uyumluluk (v0.11.0):
--  - Yeni tablo (ek_silinenler) ve yeni tetikleyici; var olan tablo/sütun silinmez, yeniden adlandırılmaz.
--  - Bütün RPC'lerin imzası ve dönüşü aynı (create or replace). Yalnız bazı çağrılar artık reddediliyor.
--  - v0.11.0 istemcisi: rolsüz yönetici "Rol oluştur"a basarsa "Bu rol senin en yüksek rolünden aşağıda
--    değil." benzeri hiyerarşi metni görür (eskisi bu kodu zaten Türkçeye çeviriyor).

-- ========== 1) YANIT GEÇERLİLİĞİ: YABANCIYA BİLGİ SIZMAZ (v07 K-2) ==========

-- 009'un aynısı; tek ek: çağıran kanalın sunucusunun üyesi olmalı. Politika ve RPC'ler zaten üyelik istediği
-- için gönderim davranışı değişmez.
create or replace function public.reply_ok(rid bigint, cid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select rid is null or exists (
    select 1 from public.messages m
      join public.channels c on c.id = m.channel_id
     where m.id = rid and m.channel_id = cid and m.deleted_at is null
       and public.is_member(c.server_id)
  );
$$;

-- DM karşılığı: çağıran konuşmanın tarafı (grupta üyesi) olmalı
create or replace function public.dm_reply_ok(rid bigint, tid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select rid is null or (
    public.is_dm_participant(tid)
    and exists (
      select 1 from public.dm_messages m
       where m.id = rid and m.thread_id = tid and m.deleted_at is null and m.kind = 'text'
    )
  );
$$;

revoke all on function public.reply_ok(bigint, uuid) from public, anon;
revoke all on function public.dm_reply_ok(bigint, uuid) from public, anon;
grant execute on function public.reply_ok(bigint, uuid) to authenticated;
grant execute on function public.dm_reply_ok(bigint, uuid) to authenticated;

-- ========== 2) ROLLER: KİLİT SIRASI VE HİYERARŞİ (v11 K2, K3, K4) ==========

-- Bu rolü, çağıranla aynı ya da daha yüksek sırada olan (sahip ve çağıranın kendisi hariç) biri taşıyor mu?
-- ust: çağıranın en yüksek rol sırası. Yalnız veritabanı içinde (kilit çağırandadır).
create or replace function public.rolu_ustteki_tasiyor(rid uuid, sid uuid, ust int)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.member_roles mr
     where mr.role_id = rid and mr.server_id = sid
       and mr.user_id <> auth.uid()
       and not exists (select 1 from public.servers s where s.id = sid and s.owner_id = mr.user_id)
       and public.uye_ust_sira(sid, mr.user_id) >= ust
  );
$$;

revoke all on function public.rolu_ustteki_tasiyor(uuid, uuid, int) from public, anon, authenticated;

-- Rol oluşturur (013'ün aynısı). Tek ek: sahip olmayan ve hiç rolü olmayan (üst sırası 0) kişi
-- ROLE_HIERARCHY alır. Rolü olan kişi için yeni rol (sıra 1) kendi rolünün altında kalır: var olan roller
-- (onunki dahil) bir yukarı kayar.
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
  ust int;
begin
  if ben is null or sid is null then
    raise exception 'NOT_ALLOWED';
  end if;
  perform public.rol_kilidi(sid);
  ust := public.rol_yoneticisi(sid);
  if ust < 1 then
    raise exception 'ROLE_HIERARCHY';
  end if;
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

-- Rolü düzenler (013'ün aynısı). Tek ek: @herkes dışındaki rolden izin KALDIRILIYORSA ve rolü çağıranla aynı
-- ya da daha yüksek sırada biri taşıyorsa ROLE_HIERARCHY (o kişi izni kaybederdi). İzin eklemek, ad ve renk serbest.
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
  kalkan text[];
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
  -- Kaldırılan izinler: üstteki (ya da eşit sıradaki) taşıyan varsa reddedilir
  select coalesce(array_agg(p), '{}'::text[]) into kalkan
    from (select unnest(r.permissions) except select unnest(dizi)) as k(p);
  if not r.is_default and cardinality(kalkan) > 0 and ust < 2147483647
     and public.rolu_ustteki_tasiyor(rid, r.server_id, ust) then
    raise exception 'ROLE_HIERARCHY';
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

-- Rolü siler (013'ün aynısı). Tek ek: rolü çağıranla aynı ya da daha yüksek sırada biri taşıyorsa
-- ROLE_HIERARCHY (set_member_role ile aynı kural: üstteki kişinin rolü elinden alınamaz).
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
  if ust < 2147483647 and public.rolu_ustteki_tasiyor(rid, r.server_id, ust) then
    raise exception 'ROLE_HIERARCHY';
  end if;

  delete from public.roles x where x.id = rid;
  perform public.rolleri_sirala(r.server_id);
end;
$$;

-- Üyeyi çıkarır (013'ün aynısı). Tek fark: izin denetimi rol kilidinden SONRA. Kilidi beklerken çağıranın
-- KICK_MEMBERS rolü alınmışsa (o işlem commit olduysa) çıkarma artık yapılmaz.
create or replace function public.kick_member(sid uuid, uid uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  ben uuid := auth.uid();
begin
  if ben is null or sid is null or uid is null then
    raise exception 'NOT_ALLOWED';
  end if;
  perform public.rol_kilidi(sid);
  if not public.is_member(sid) or not public.has_permission(sid, ben, 'KICK_MEMBERS') then
    raise exception 'NOT_ALLOWED';
  end if;
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

revoke all on function public.create_role(uuid, text, text, text[]) from public, anon;
revoke all on function public.update_role(uuid, text, text, text[], boolean) from public, anon;
revoke all on function public.delete_role(uuid) from public, anon;
revoke all on function public.kick_member(uuid, uuid) from public, anon;
grant execute on function public.create_role(uuid, text, text, text[]) to authenticated;
grant execute on function public.update_role(uuid, text, text, text[], boolean) to authenticated;
grant execute on function public.delete_role(uuid) to authenticated;
grant execute on function public.kick_member(uuid, uuid) to authenticated;

-- ========== 3) MODERATÖR VE BAĞSIZ DOSYALAR (v11 K6) ==========

-- Yumuşak silinen kanal mesajlarının ek yolları (moderatör dosyayı depodan silebilsin diye). Yalnız veritabanı
-- içinde okunur (RLS açık, politika yok). 1 günden eski satırlar her yeni silmede temizlenir.
create table if not exists public.ek_silinenler (
  path text primary key,
  channel_id uuid not null references public.channels(id) on delete cascade,
  deleted_at timestamptz not null default now()
);
create index if not exists ek_silinenler_zaman_idx on public.ek_silinenler (deleted_at);
alter table public.ek_silinenler enable row level security;

-- 010'un aynısı; tek ek: kanal mesajının ek yolları silinmeden önce ek_silinenler'e yazılır.
create or replace function public.mesaj_silinince_temizle()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_table_name = 'messages' then
    delete from public.message_reactions r where r.message_id = new.id;
    delete from public.message_pins p where p.message_id = new.id;
    delete from public.ek_silinenler s where s.deleted_at < now() - interval '1 day';
    insert into public.ek_silinenler (path, channel_id)
    select a.path, new.channel_id from public.attachments a where a.message_id = new.id
    on conflict (path) do update set deleted_at = now();
    delete from public.attachments a where a.message_id = new.id;
  else
    delete from public.dm_message_reactions r where r.message_id = new.id;
    delete from public.dm_message_pins p where p.message_id = new.id;
    delete from public.attachments a where a.dm_message_id = new.id;
  end if;
  return null;
end;
$$;

revoke all on function public.mesaj_silinince_temizle() from public, anon;
grant execute on function public.mesaj_silinince_temizle() to authenticated;

-- Bu ek yolunu silebilir miyim? (013'ün aynısı; moderatör dalı daraltıldı)
--  - Kendi klasörüm: evet.
--  - k: kanalın sunucusunda MANAGE_MESSAGES iznim var, nesne hiçbir mesaja bağlı değil VE son 1 günde silinmiş
--    bir kanal mesajının eki (ek_silinenler). Gönderilmemiş dosya moderatöre açık değil.
-- ek_okunabilir (010) bunu çağırır: aynı daralma okuma ve listelemeye de geçer.
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
  return exists (select 1 from public.ek_silinenler s
                  where s.path = yol and s.channel_id = p[2]::uuid
                    and s.deleted_at > now() - interval '1 day')
     and exists (select 1 from public.channels c
                  where c.id = p[2]::uuid
                    and public.has_permission(c.server_id, auth.uid(), 'MANAGE_MESSAGES'))
     and not exists (select 1 from public.attachments a where a.path = yol);
end;
$$;

revoke all on function public.ek_silinebilir(text) from public, anon;
grant execute on function public.ek_silinebilir(text) to authenticated;

-- ========== 4) GRUP KURUCUSU HESABINI SİLERSE (v09 K5) ==========

-- Kurucunun hesabı silinince owner_id "on delete set null" ile boşalır. Bu tetikleyici kuruculuğu, eski kurucu
-- dışındaki en eski üyeye verir (leave_group'taki sıra: joined_at, user_id). Üye kalmadıysa boş kalır.
-- Kilit (inceleme Y1): 'dmgroup:' kilidi yalnız DENENİR (pg_try_advisory_xact_lock), beklenmez. Bu noktada işlem
-- dm_threads satırını RI "set null" güncellemesiyle zaten kilitlemiş durumda; kilidi beklemek, kilidi tutan
-- leave_group/add_group_member'ın sistem satırı (dm_son_mesaj_guncelle -> dm_threads güncellemesi) ile kilitlenme
-- (deadlock) yaratırdı ve hesap silme düşerdi. Kilit alınırsa üyeler ondan sonra okunur (aynı anda ayrılan üye seçilmez).
-- Alınamazsa tetikleyici kilitsiz devam eder. En kötü durum: o anda ayrılmakta olan en eski üye kurucu seçilir; grup
-- bir süre "üye olmayan kurucu"yla kalır (kimse üye çıkaramaz). Bir sonraki leave_group bunu onarır (kurucu üye
-- değilse kuruculuğu en eski üyeye verir). Pencere milisaniyeler; hesap silme ile ayrılmanın aynı ana denk gelmesi gerekir.
-- Bildirim: kalan her üyenin "user:<uid>" konusuna "degisti" { tablo: 'dm_threads', islem: 'UPDATE' } gider
-- (007/011'deki kalıp; istemci her "degisti"de listeyi tazeler, v0.11.0 dahil). Yayın giderse hata yutulur.
create or replace function public.grup_kurucusu_devret()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  yeni uuid;
  kisi uuid;
begin
  perform pg_try_advisory_xact_lock(hashtextextended('dmgroup:' || new.id::text, 0)); -- alınamazsa da devam
  select m.user_id into yeni from public.dm_members m
   where m.thread_id = new.id and m.user_id <> old.owner_id
   order by m.joined_at, m.user_id
   limit 1;
  if yeni is null then
    return null;
  end if;
  update public.dm_threads t set owner_id = yeni where t.id = new.id and t.owner_id is null;
  for kisi in select m.user_id from public.dm_members m where m.thread_id = new.id and m.user_id <> old.owner_id loop
    begin
      perform realtime.send(
        jsonb_build_object('tablo', 'dm_threads', 'islem', 'UPDATE'),
        'degisti',
        'user:' || kisi::text,
        true
      );
    exception when others then
      null; -- yayın gitmedi: devir yine de yapılır
    end;
  end loop;
  return null;
end;
$$;

revoke all on function public.grup_kurucusu_devret() from public, anon, authenticated;

drop trigger if exists dm_threads_kurucu_devret on public.dm_threads;
create trigger dm_threads_kurucu_devret
  after update of owner_id on public.dm_threads
  for each row when (new.is_group and new.owner_id is null and old.owner_id is not null)
  execute function public.grup_kurucusu_devret();

-- Bu sürümden önce sahipsiz kalmış gruplar: bir kez onarılır
update public.dm_threads t
   set owner_id = (select m.user_id from public.dm_members m
                    where m.thread_id = t.id
                    order by m.joined_at, m.user_id
                    limit 1)
 where t.is_group and t.owner_id is null
   and exists (select 1 from public.dm_members m where m.thread_id = t.id);

-- ========== 5) SUNUCUYA KATILMA OLAYI (v12 inceleme KR1) ==========

-- 006'daki sunucu_olayi_gonder INSERT'i zaten destekler (satır new'dan, AFTER'da dönüş kullanılmaz). Olay
-- "server:<sid>" konusuna gider. v0.11.0 istemcisi bu olayda üye listesini ve sunucu/kanal listelerini tazeler
-- (silme olayıyla aynı yol); bozulmaz.
drop trigger if exists server_members_eklendi on public.server_members;
create trigger server_members_eklendi
  after insert on public.server_members
  for each row execute function public.sunucu_olayi_gonder();
