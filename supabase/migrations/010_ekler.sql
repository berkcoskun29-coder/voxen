-- 010: Dosya ve resim ekleri (v0.8.0).
-- Bu dosyada:
--  1) messages/dm_messages.attachment_count (varsayılan 0): canlı INSERT olayında "bu mesajın eki var"
--  2) attachments tablosu (mesaja ya da DM mesajına bağlı; RLS: mesajı gören eki görür; yazma yalnız RPC)
--  3) Storage: özel "ekler" kovası (8 MB, depoda yalnız 4 resim türü + octet-stream) ve storage.objects
--     politikaları (yol: k/<kanal>/<kişi>/<uuid>-<ad>, d/<konuşma>/<kişi>/<uuid>-<ad>)
--  4) RPC'ler: send_message_with_attachments, send_dm_with_attachments (mesaj + ekler tek işlemde),
--     ek_kullanimim (kota), yetim_eklerim (mesaja bağlı olmayan kendi nesnelerin; istemci Storage API ile siler)
--  5) Yumuşak silinen mesajın ek satırları da silinir (009'daki tetikleyici fonksiyonu genişler)
--
-- Hata kodları (istemci src/data/ekKurallari.js / attachments.js Türkçeye çevirir):
--   NOT_ALLOWED, BLOCKED_DM, REPLY_GONE, TOO_MANY, TOO_LARGE, BLOCKED_TYPE, BAD_ATTACHMENT, QUOTA.
-- Engel bilgisi sızmaz (007 gibi): engelleyen BLOCKED_DM, engellenen NOT_ALLOWED alır.
--
-- Depodaki nesne SQL ile SİLİNMEZ: storage.objects satırını silmek dosyanın kendisini bırakır (Supabase
-- yeni sürümlerde bunu engeller de). Silme her zaman istemcinin Storage API çağrısıyla (remove) yapılır.
--
-- Uyumluluk (v0.7.0 ve öncesi):
--  - messages/dm_messages'a yalnız varsayılanlı attachment_count eklenir. Silinen/yeniden adlandırılan sütun yok.
--  - İçerik kısıtları (1–2000) DEĞİŞMEZ: yazısız ekli mesajın içeriği "📎 dosya" olur; eski istemci bunu görür.
--  - INSERT politikaları, edit/delete RPC'leri, dm_list, unread_counts değişmez. Yazılı mesajın yolu aynı.

-- ========== 1) MESAJDA EK SAYISI ==========

alter table public.messages add column if not exists attachment_count smallint not null default 0
  check (attachment_count between 0 and 4);
alter table public.dm_messages add column if not exists attachment_count smallint not null default 0
  check (attachment_count between 0 and 4);

-- ========== 2) ATTACHMENTS ==========

create table if not exists public.attachments (
  id bigint generated always as identity primary key,
  message_id bigint references public.messages(id) on delete cascade,
  dm_message_id bigint references public.dm_messages(id) on delete cascade,
  uploader uuid not null references auth.users(id) on delete cascade,
  path text not null unique,
  name text not null check (length(name) between 1 and 255),
  mime text not null check (length(mime) between 1 and 255),
  size bigint not null check (size between 0 and 8388608),
  width integer check (width between 1 and 20000),
  height integer check (height between 1 and 20000),
  created_at timestamptz not null default now(),
  constraint attachments_tek_mesaj check (num_nonnulls(message_id, dm_message_id) = 1)
);

create index if not exists attachments_message_idx on public.attachments (message_id) where message_id is not null;
create index if not exists attachments_dm_message_idx on public.attachments (dm_message_id) where dm_message_id is not null;
create index if not exists attachments_uploader_idx on public.attachments (uploader);

alter table public.attachments enable row level security;

-- Mesajı gören eki görür: kanal mesajında sunucu üyeleri, DM mesajında iki taraf.
-- Yazma politikası yok: ekler yalnız RPC ile yazılır, mesajla birlikte (cascade/tetikleyiciyle) silinir.
drop policy if exists attachments_select on public.attachments;
create policy attachments_select on public.attachments
  for select to authenticated
  using (
    (message_id is not null and exists (
      select 1 from public.messages m
      join public.channels c on c.id = m.channel_id
      where m.id = message_id and public.is_member(c.server_id)))
    or
    (dm_message_id is not null and exists (
      select 1 from public.dm_messages m
      where m.id = dm_message_id and public.is_dm_participant(m.thread_id)))
  );

-- ========== 3) TÜR KURALLARI ==========

-- Dosya adının uzantısı (küçük harf, noktasız); yoksa null.
-- Sondaki nokta ve boşluklar önce kırpılır: Windows/tarayıcı "virus.exe." adını "virus.exe" olarak kaydeder.
create or replace function public.ek_uzanti(ad text)
returns text
language sql
immutable
security definer
set search_path = public
as $$
  select lower(substring(regexp_replace(coalesce(ad, ''), '[.[:space:]]+$', '') from '\.([^./\\]+)$'));
$$;

-- Adda kontrol ya da görünmez biçim karakteri var mı (ör. U+202E sağdan sola: "fdp.exe" gibi görünen ad,
-- U+200B sıfır genişlikli boşluk). Böyle adlar yasaklı sayılır. İstemci: ekKurallari.js gizliKarakterVar.
create or replace function public.ek_adi_gizli_karakterli(ad text)
returns boolean
language sql
immutable
security definer
set search_path = public
as $$
  select coalesce(ad, '') ~ '[\x01-\x1f\x7f-\x9f\u00ad\u061c\u180e\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u206f\ufeff\ufff9-\ufffb]';
$$;

-- Yasaklı tür mü (uzantıya YA DA MIME'ye göre). İstemcideki listelerle AYNI
-- (src/data/ekKurallari.js YASAK_UZANTILAR / YASAK_MIMELER; tests/schema010.test.js denetler).
create or replace function public.ek_turu_yasak(ad text, mime text)
returns boolean
language sql
immutable
security definer
set search_path = public
as $$
  select public.ek_adi_gizli_karakterli(ad)
    or coalesce(public.ek_uzanti(ad) = any (array[
      'exe','msi','bat','cmd','ps1','sh','js','vbs','scr','jar','html','htm','svg'
    ]), false)
    or coalesce(lower(btrim(split_part(coalesce(mime, ''), ';', 1))) = any (array[
      'application/x-msdownload',
      'application/x-msi',
      'application/x-ms-installer',
      'application/x-msdos-program',
      'application/x-dosexec',
      'application/vnd.microsoft.portable-executable',
      'application/x-bat',
      'application/x-sh',
      'application/x-shellscript',
      'text/x-shellscript',
      'application/x-powershell',
      'application/javascript',
      'application/x-javascript',
      'application/ecmascript',
      'text/javascript',
      'text/ecmascript',
      'text/vbscript',
      'application/x-vbscript',
      'application/java-archive',
      'application/x-java-archive',
      'text/html',
      'application/xhtml+xml',
      'image/svg+xml'
    ]), false);
$$;

revoke all on function public.ek_uzanti(text) from public, anon;
revoke all on function public.ek_adi_gizli_karakterli(text) from public, anon;
grant execute on function public.ek_adi_gizli_karakterli(text) to authenticated;
revoke all on function public.ek_turu_yasak(text, text) from public, anon;
grant execute on function public.ek_uzanti(text) to authenticated;
grant execute on function public.ek_turu_yasak(text, text) to authenticated;

-- ========== 4) STORAGE: KOVA VE POLİTİKALAR ==========

-- Özel kova. Dosya başı 8 MB. Depoda yalnız resimler (kendi türüyle) ve octet-stream durur:
-- istemci resim olmayan her dosyayı octet-stream olarak yükler; imzalı adres hiçbir dosyayı
-- HTML/betik olarak sunamaz. Dosyanın asıl türü attachments.mime'de.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('ekler', 'ekler', false, 8388608,
        array['image/png','image/jpeg','image/gif','image/webp','application/octet-stream'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Kişinin depoda (kendi klasörlerinde) kapladığı alan. Yetim nesneler de sayılır.
create or replace function public.ek_depo_kullanimi(uid uuid)
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(coalesce((o.metadata ->> 'size')::bigint, 0)), 0)::bigint
    from storage.objects o
   where o.bucket_id = 'ekler'
     and (storage.foldername(o.name))[3] = uid::text;
$$;

-- Bu yolu silebilir miyim?
--  - Kendi klasörüm: evet.
--  - k: kanalın sunucusunun SAHİBİYİM ve nesne hiçbir mesaja bağlı değil (attachments satırı yok).
--    Moderasyon: sahip başkasının ekli mesajını silince (satır tetikleyiciyle gider) dosyayı da siler.
--    Mesaja bağlı dosya (satırı duran) sahibince silinemez: önce mesaj silinmeli.
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
                 join public.servers s on s.id = c.server_id
                 where c.id = p[2]::uuid and s.owner_id = auth.uid())
     and not exists (select 1 from public.attachments a where a.path = yol);
end;
$$;

-- Bu yolu okuyabilir miyim? Yol: <k|d>/<kanal|konuşma>/<kişi>/<dosya>.
--  - Kendi klasörüm: evet (gönderim öncesi ve silme için; Storage API silerken okuma izni de ister).
--  - Silebildiğim (sunucu sahibi, bağsız kanal nesnesi): evet (silme, okuma izni ister).
--  - Başkasının dosyası: YALNIZ bir mesaja bağlıysa (attachments satırı var) ve
--    k: o kanalın sunucusunun üyesiyim, d: o konuşmanın tarafıyım.
--    Gönderilmemiş ya da mesajı silinmiş (satırı gitmiş) dosya başkasınca okunamaz, listelenemez.
-- Başka her yol (bozuk, yabancı) hayır. Yalnız çağıranın kendi erişimini söyler.
create or replace function public.ek_okunabilir(yol text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  p text[] := storage.foldername(yol);
  hedef uuid;
begin
  if auth.uid() is null or p is null or coalesce(array_length(p, 1), 0) <> 3 then
    return false;
  end if;
  if p[3] = auth.uid()::text then
    return true;
  end if;
  if public.ek_silinebilir(yol) then
    return true;
  end if;
  if p[2] !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;
  if not exists (select 1 from public.attachments a where a.path = yol) then
    return false;
  end if;
  hedef := p[2]::uuid;
  if p[1] = 'k' then
    return exists (select 1 from public.channels c
                   where c.id = hedef and public.is_member(c.server_id));
  elsif p[1] = 'd' then
    return public.is_dm_participant(hedef);
  end if;
  return false;
end;
$$;

-- Bu yola yükleyebilir miyim?
--  - Yalnız kendi klasörüme (<kişi> = ben), tam 3 klasör derinliğinde.
--  - Uzantı yasaklı değil (MIME'yi kova sınırlar: allowed_mime_types).
--  - Depodaki toplamım 150 MB'ın altında (hiç gönderilmeyen dosyalarla sınır aşılmasın).
--  - k: kanalın sunucusunun üyesiyim. d: konuşmaya yazabiliyorum (can_send_dm: engelde hayır).
create or replace function public.ek_yuklenebilir(yol text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  p text[] := storage.foldername(yol);
  hedef uuid;
begin
  if auth.uid() is null or p is null or coalesce(array_length(p, 1), 0) <> 3
     or p[3] <> auth.uid()::text then
    return false;
  end if;
  if p[2] !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;
  if public.ek_turu_yasak(yol, null) then
    return false;
  end if;
  if public.ek_depo_kullanimi(auth.uid()) >= 157286400 then
    return false;
  end if;
  hedef := p[2]::uuid;
  if p[1] = 'k' then
    return exists (select 1 from public.channels c
                   where c.id = hedef and public.is_member(c.server_id));
  elsif p[1] = 'd' then
    return public.can_send_dm(hedef);
  end if;
  return false;
end;
$$;

revoke all on function public.ek_depo_kullanimi(uuid) from public, anon, authenticated;
revoke all on function public.ek_okunabilir(text) from public, anon;
revoke all on function public.ek_silinebilir(text) from public, anon;
grant execute on function public.ek_silinebilir(text) to authenticated;
revoke all on function public.ek_yuklenebilir(text) from public, anon;
grant execute on function public.ek_okunabilir(text) to authenticated;
grant execute on function public.ek_yuklenebilir(text) to authenticated;

-- storage.objects politikaları (yalnız "ekler" kovası). Güncelleme politikası yok: üzerine yazılmaz.
drop policy if exists ekler_select on storage.objects;
create policy ekler_select on storage.objects
  for select to authenticated
  using (bucket_id = 'ekler' and public.ek_okunabilir(name));

drop policy if exists ekler_insert on storage.objects;
create policy ekler_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'ekler' and public.ek_yuklenebilir(name));

drop policy if exists ekler_delete on storage.objects;
create policy ekler_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'ekler' and public.ek_silinebilir(name));

-- ========== 5) GÖNDERME RPC'LERİ ==========

-- Ortak ek denetimi: ekler dizisini (1–4 öğe) denetler, her öğenin depodaki gerçek boyutunu ve türünü
-- storage.objects'ten okur (istemcinin söylediğine güvenmez), kotayı denetler.
-- onek: 'k/<kanal>/<ben>/' ya da 'd/<konuşma>/<ben>/'. Dönüş: toplam boyut.
-- Kota kişi başı danışma kilidiyle sıraya girer: aynı anda iki gönderim sınırı birlikte aşamaz.
create or replace function public.ekleri_denetle(ekler jsonb, onek text)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  ben uuid := auth.uid();
  e jsonb;
  yol text;
  ad text;
  beyan text;
  depo text;
  boyut bigint;
  toplam bigint := 0;
  gorulen text[] := array[]::text[];
  kullanilan bigint;
  o record;
begin
  if ekler is null or jsonb_typeof(ekler) <> 'array' or jsonb_array_length(ekler) < 1 then
    raise exception 'BAD_ATTACHMENT';
  end if;
  if jsonb_array_length(ekler) > 4 then
    raise exception 'TOO_MANY';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('ek:' || ben::text, 0));

  for e in select * from jsonb_array_elements(ekler) loop
    if jsonb_typeof(e) <> 'object' then
      raise exception 'BAD_ATTACHMENT';
    end if;
    yol := e ->> 'path';
    ad := btrim(coalesce(e ->> 'name', ''));
    beyan := lower(btrim(split_part(coalesce(e ->> 'mime', ''), ';', 1)));
    -- Yol: tam olarak <onek><dosya> (kendi klasörüm, bu konuşma; alt klasör yok)
    if yol is null or left(yol, length(onek)) <> onek
       or length(yol) = length(onek) or position('/' in substr(yol, length(onek) + 1)) > 0 then
      raise exception 'BAD_ATTACHMENT';
    end if;
    if length(ad) not between 1 and 255 or length(beyan) not between 1 and 255 then
      raise exception 'BAD_ATTACHMENT';
    end if;
    if yol = any (gorulen) then
      raise exception 'BAD_ATTACHMENT'; -- aynı dosya dizide iki kez (kota da iki kez sayılmasın)
    end if;
    gorulen := gorulen || yol;
    if exists (select 1 from public.attachments a where a.path = yol) then
      raise exception 'BAD_ATTACHMENT'; -- aynı dosya iki mesaja bağlanmaz
    end if;

    select so.metadata into o from storage.objects so where so.bucket_id = 'ekler' and so.name = yol;
    if not found then
      raise exception 'BAD_ATTACHMENT'; -- yüklenmemiş
    end if;
    boyut := coalesce((o.metadata ->> 'size')::bigint, -1);
    depo := lower(btrim(split_part(coalesce(o.metadata ->> 'mimetype', ''), ';', 1)));
    if boyut < 0 or boyut > 8388608 then
      raise exception 'TOO_LARGE';
    end if;
    if public.ek_turu_yasak(yol, depo) or public.ek_turu_yasak(ad, beyan) then
      raise exception 'BLOCKED_TYPE';
    end if;
    -- Resim kendi türüyle, diğer her şey octet-stream olarak depolanır
    if not ((depo = beyan and depo in ('image/png','image/jpeg','image/gif','image/webp'))
            or (depo = 'application/octet-stream'
                and beyan not in ('image/png','image/jpeg','image/gif','image/webp'))) then
      raise exception 'BLOCKED_TYPE';
    end if;
    toplam := toplam + boyut;
  end loop;

  select coalesce(sum(a.size), 0) into kullanilan from public.attachments a where a.uploader = ben;
  if kullanilan + toplam > 157286400 then
    raise exception 'QUOTA';
  end if;
  return toplam;
end;
$$;

-- Ek satırlarını yazar (sıra korunur). Boyut ve tür depodaki kayıttan. Genişlik/yükseklik istemciden
-- (yalnız görünüm için; geçersizse boş).
create or replace function public.ekleri_yaz(ekler jsonb, mid bigint, dmid bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  e jsonb;
  g integer;
  y integer;
begin
  for e in select value from jsonb_array_elements(ekler) with ordinality as x(value, sira) order by sira loop
    g := case when jsonb_typeof(e -> 'width') = 'number' then (e ->> 'width')::numeric::integer end;
    y := case when jsonb_typeof(e -> 'height') = 'number' then (e ->> 'height')::numeric::integer end;
    if g is not null and g not between 1 and 20000 then g := null; end if;
    if y is not null and y not between 1 and 20000 then y := null; end if;
    insert into public.attachments (message_id, dm_message_id, uploader, path, name, mime, size, width, height)
    select mid, dmid, auth.uid(), so.name, btrim(e ->> 'name'),
           lower(btrim(split_part(e ->> 'mime', ';', 1))),
           (so.metadata ->> 'size')::bigint, g, y
      from storage.objects so
     where so.bucket_id = 'ekler' and so.name = e ->> 'path';
  end loop;
end;
$$;

revoke all on function public.ekleri_denetle(jsonb, text) from public, anon, authenticated;
revoke all on function public.ekleri_yaz(jsonb, bigint, bigint) from public, anon, authenticated;

-- Kanala ekli mesaj gönderir: mesaj ve ek satırları tek işlemde. Dönüş: mesaj satırı.
-- Şartlar messages_insert politikasıyla aynı (üye, yanıt aynı kanalda ve silinmemiş).
-- Yazı boşsa içerik "📎 dosya" olur (içerik kısıtı ve eski istemci için).
create or replace function public.send_message_with_attachments(cid uuid, metin text, ekler jsonb, yanit bigint)
returns public.messages
language plpgsql
security definer
set search_path = public
as $$
declare
  ben uuid := auth.uid();
  govde text := btrim(coalesce(metin, ''), E' \t\r\n');
  m public.messages;
begin
  if ben is null or cid is null then
    raise exception 'NOT_ALLOWED';
  end if;
  if not exists (select 1 from public.channels c where c.id = cid and public.is_member(c.server_id)) then
    raise exception 'NOT_ALLOWED';
  end if;
  if yanit is not null and not public.reply_ok(yanit, cid) then
    raise exception 'REPLY_GONE';
  end if;
  if length(govde) > 2000 then
    raise exception 'NOT_ALLOWED';
  end if;

  perform public.ekleri_denetle(ekler, 'k/' || cid::text || '/' || ben::text || '/');

  insert into public.messages (channel_id, author_id, content, reply_to, attachment_count)
  values (cid, ben, case when govde = '' then '📎 dosya' else govde end, yanit,
          jsonb_array_length(ekler))
  returning * into m;

  perform public.ekleri_yaz(ekler, m.id, null);
  return m;
end;
$$;

-- DM'e ekli mesaj gönderir. Şartlar dm_messages_insert ile aynı (taraf, engel yok, yanıt geçerli).
-- Engel kodu engelleyene göre: BLOCKED_DM / NOT_ALLOWED (engel bilgisi sızmaz).
create or replace function public.send_dm_with_attachments(tid uuid, metin text, ekler jsonb, yanit bigint)
returns public.dm_messages
language plpgsql
security definer
set search_path = public
as $$
declare
  ben uuid := auth.uid();
  govde text := btrim(coalesce(metin, ''), E' \t\r\n');
  t public.dm_threads;
  diger uuid;
  m public.dm_messages;
begin
  if ben is null or tid is null or not public.is_dm_participant(tid) then
    raise exception 'NOT_ALLOWED';
  end if;
  select * into t from public.dm_threads th where th.id = tid;
  diger := case when t.user_a = ben then t.user_b else t.user_a end;
  if exists (select 1 from public.blocks bl where bl.blocker = ben and bl.blocked = diger) then
    raise exception 'BLOCKED_DM';
  end if;
  if public.engel_var(t.user_a, t.user_b) then
    raise exception 'NOT_ALLOWED';
  end if;
  if yanit is not null and not public.dm_reply_ok(yanit, tid) then
    raise exception 'REPLY_GONE';
  end if;
  if length(govde) > 2000 then
    raise exception 'NOT_ALLOWED';
  end if;

  perform public.ekleri_denetle(ekler, 'd/' || tid::text || '/' || ben::text || '/');

  insert into public.dm_messages (thread_id, author_id, content, reply_to, attachment_count, kind)
  values (tid, ben, case when govde = '' then '📎 dosya' else govde end, yanit,
          jsonb_array_length(ekler), 'text')
  returning * into m;

  perform public.ekleri_yaz(ekler, null, m.id);
  return m;
end;
$$;

-- Kişinin kullandığı alan (bayt): ek satırlarının toplamı ile depodaki toplamın büyüğü.
-- İstemci yüklemeye başlamadan bakar ("Depolama sınırına ulaştın…"). Yalnız kendi kullanımını söyler.
create or replace function public.ek_kullanimim()
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select greatest(
    (select coalesce(sum(a.size), 0) from public.attachments a where a.uploader = auth.uid()),
    public.ek_depo_kullanimi(auth.uid())
  )::bigint
  where auth.uid() is not null;
$$;

-- Kendi klasörlerimde olup hiçbir mesaja bağlı olmayan, 1 saatten eski nesneler (en çok 100).
-- Kapsar: yüklenip gönderilmeyenler, mesajı başkası (sunucu sahibi) silenler, kanal/sunucu silinince kalanlar.
-- İstemci dönen yolları Storage API ile siler (remove); SQL ile silmek dosyayı depoda bırakırdı.
create or replace function public.yetim_eklerim()
returns setof text
language sql
stable
security definer
set search_path = public
as $$
  select o.name
    from storage.objects o
   where auth.uid() is not null
     and o.bucket_id = 'ekler'
     and (storage.foldername(o.name))[3] = auth.uid()::text
     and o.created_at < now() - interval '1 hour'
     and not exists (select 1 from public.attachments a where a.path = o.name)
   order by o.created_at
   limit 100;
$$;

revoke all on function public.send_message_with_attachments(uuid, text, jsonb, bigint) from public, anon;
revoke all on function public.send_dm_with_attachments(uuid, text, jsonb, bigint) from public, anon;
revoke all on function public.ek_kullanimim() from public, anon;
revoke all on function public.yetim_eklerim() from public, anon;
grant execute on function public.send_message_with_attachments(uuid, text, jsonb, bigint) to authenticated;
grant execute on function public.send_dm_with_attachments(uuid, text, jsonb, bigint) to authenticated;
grant execute on function public.ek_kullanimim() to authenticated;
grant execute on function public.yetim_eklerim() to authenticated;

-- ========== 6) YUMUŞAK SİLMEDE EKLER ==========

-- 009'daki fonksiyonun aynısı; tek ek: ek satırları da silinir (depodaki dosyayı istemci ya da
-- yetim temizliği siler). Tetikleyiciler (messages_silinince, dm_messages_silinince) 009'daki gibi kalır.
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
