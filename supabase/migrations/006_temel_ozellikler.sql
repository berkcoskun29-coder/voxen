-- 006: Temel özellikler (v0.3.0).
-- Bu dosyada:
--  1) Mesaj düzenleme ve silme (yumuşak silme: satır kalır, içerik boşalır)
--  2) Sunucudan ayrılma, sunucuyu silme, sunucu adını değiştirme
--  3) Kanalı silme ve yeniden adlandırma (son yazılı kanal silinemez)
--  4) Okunmamış mesaj sayısı (channel_reads tablosu + iki RPC + geriye dönük doldurma)
--  5) Realtime yetkileri: "server:<uuid>" (sunucu olayları) ve "typing:<uuid>" (yazıyor göstergesi)
--  6) Tetikleyiciler: sunucu/kanal/üyelik değişince o sunucunun üyelerine "degisti" olayı
-- Uyumluluk: v0.2.1 istemcileri mesajı yine doğrudan INSERT ile gönderir; yeni sütunlar
-- eski istemcinin select sorgularında fazladan alan olarak gelir, bir şey bozmaz.

-- ========== 1) MESAJ DÜZENLEME VE SİLME ==========

alter table public.messages add column if not exists edited_at timestamptz;
alter table public.messages add column if not exists deleted_at timestamptz;

-- Eski içerik kısıtı (001: length(content) between 1 and 2000) kaldırılır.
-- Adı Postgres'in verdiği addır (messages_content_check); yine de içeriğine bakarak buluruz.
do $$
declare
  k record;
begin
  for k in
    select conname from pg_constraint
    where conrelid = 'public.messages'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%length(content)%'
  loop
    execute format('alter table public.messages drop constraint %I', k.conname);
  end loop;
end;
$$;

-- Yeni kural: silinmemiş mesaj 1–2000 karakter; silinmiş mesajın içeriği boş.
alter table public.messages drop constraint if exists messages_content_len;
alter table public.messages add constraint messages_content_len check (
  (deleted_at is null and length(content) between 1 and 2000)
  or (deleted_at is not null and content = '')
);

-- Gönderme yine doğrudan INSERT (v0.2.1 bozulmasın), ama yeni satır "silinmiş" ya da
-- "düzenlenmiş" olarak yazılamaz. Düzenleme/silme için UPDATE/DELETE izni hiç yok: yalnız RPC.
drop policy if exists messages_insert on public.messages;
create policy messages_insert on public.messages
  for insert to authenticated
  with check (
    author_id = auth.uid()
    and deleted_at is null
    and edited_at is null
    and exists (select 1 from public.channels c
                where c.id = channel_id and public.is_member(c.server_id))
  );

-- Mesajı düzenler: yalnız yazarı (hâlâ üyeyse), silinmemiş mesajda, 1–2000 karakter.
-- Düzenlenen satırı döner (arayüz hemen yerinde günceller).
create or replace function public.edit_message(id bigint, yeni text)
returns public.messages
language plpgsql
security definer
set search_path = public
as $$
declare
  m public.messages;
  metin text := btrim(coalesce(yeni, ''), E' \t\r\n');
begin
  if auth.uid() is null then
    raise exception 'Giriş yapmalısın';
  end if;

  -- Satırı kilitle: aynı anda silme/düzenleme yarışmasın
  select * into m from public.messages where messages.id = edit_message.id for update;
  if not found or m.deleted_at is not null
     or not exists (select 1 from public.channels c
                    where c.id = m.channel_id and public.is_member(c.server_id)) then
    raise exception 'Mesaj bulunamadı';
  end if;
  if m.author_id <> auth.uid() then
    raise exception 'Yalnız kendi mesajını düzenleyebilirsin';
  end if;
  if length(metin) not between 1 and 2000 then
    raise exception 'Mesaj 1–2000 karakter olmalı';
  end if;

  update public.messages
     set content = metin, edited_at = now()
   where messages.id = edit_message.id
  returning * into m;
  return m;
end;
$$;

-- Mesajı siler (yumuşak): yazarı ya da mesajın sunucusunun sahibi.
-- Satır kalır; deleted_at dolar, içerik boşalır. Realtime bunu UPDATE olayı olarak iletir.
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
     and not exists (select 1 from public.servers s where s.id = sid and s.owner_id = auth.uid()) then
    raise exception 'Bu mesajı silemezsin';
  end if;

  update public.messages
     set content = '', deleted_at = now()
   where messages.id = delete_message.id;
end;
$$;

revoke all on function public.edit_message(bigint, text) from public, anon;
revoke all on function public.delete_message(bigint) from public, anon;
grant execute on function public.edit_message(bigint, text) to authenticated;
grant execute on function public.delete_message(bigint) to authenticated;

-- ========== 2) OKUNMAMIŞ: channel_reads ==========
-- Kişi başı, kanal başı "en son okuduğum mesaj id'si".

create table if not exists public.channel_reads (
  user_id uuid not null references auth.users(id) on delete cascade,
  channel_id uuid not null references public.channels(id) on delete cascade,
  last_read_id bigint not null default 0,
  primary key (user_id, channel_id)
);

-- Kanal silinince satırları hızlı bulmak için (cascade)
create index if not exists channel_reads_channel_idx on public.channel_reads (channel_id);

alter table public.channel_reads enable row level security;

-- Kişi yalnız kendi satırlarını okur ve yazar. Yazarken kanalın sunucusuna üye olmalı.
-- (Uygulama yazmayı mark_read ile yapar; bu kurallar doğrudan isteği de sınırlar.)
drop policy if exists channel_reads_select on public.channel_reads;
create policy channel_reads_select on public.channel_reads
  for select to authenticated
  using (user_id = auth.uid());
drop policy if exists channel_reads_insert on public.channel_reads;
create policy channel_reads_insert on public.channel_reads
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (select 1 from public.channels c
                where c.id = channel_id and public.is_member(c.server_id))
  );
drop policy if exists channel_reads_update on public.channel_reads;
create policy channel_reads_update on public.channel_reads
  for update to authenticated
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and exists (select 1 from public.channels c
                where c.id = channel_id and public.is_member(c.server_id))
  );
drop policy if exists channel_reads_delete on public.channel_reads;
create policy channel_reads_delete on public.channel_reads
  for delete to authenticated
  using (user_id = auth.uid());

-- Geriye dönük doldurma: var olan her üye × yazılı kanal için satır, kanalın şu anki
-- en son mesaj id'siyle (mesaj yoksa 0). Böylece güncellemeden sonra eski mesajlar
-- kimseye "okunmamış" görünmez.
insert into public.channel_reads (user_id, channel_id, last_read_id)
select sm.user_id, c.id,
       coalesce((select max(m.id) from public.messages m where m.channel_id = c.id), 0)
from public.server_members sm
join public.channels c on c.server_id = sm.server_id and c.kind = 'text'
on conflict (user_id, channel_id) do nothing;

-- Üyesi olduğum bütün yazılı kanallar için okunmamış sayısı (en fazla 100), tek sorguda.
-- İstemci sayıyı olduğu gibi gösterir; 99'dan büyükse "99+" yazar (100 = "99'dan fazla").
-- Sayılan: taban id'den büyük, silinmemiş, BAŞKASININ yazdığı mesajlar.
-- Taban id: channel_reads.last_read_id; kayıt yoksa sunucuya katıldığım ana kadarki en büyük
-- mesaj id'si (hiç yoksa 0). Taban önce hesaplanır, sayım düz "id > taban" olur:
-- böylece (channel_id, id) indeksi kullanılır, CASE ile satır satır süzülmez.
create or replace function public.unread_counts()
returns table (channel_id uuid, server_id uuid, count int)
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
          ) x)
  from public.server_members sm
  join public.channels c on c.server_id = sm.server_id and c.kind = 'text'
  left join public.channel_reads r on r.channel_id = c.id and r.user_id = sm.user_id
  cross join lateral (
    select coalesce(
             r.last_read_id,
             (select max(m0.id) from public.messages m0
              where m0.channel_id = c.id and m0.created_at <= sm.joined_at),
             0) as taban
  ) t
  where sm.user_id = auth.uid();
$$;

-- Okundu işareti: yalnız ileri gider (daha küçük id gelirse değişmez). Üyelik denetlenir.
create or replace function public.mark_read(cid uuid, mid bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Giriş yapmalısın';
  end if;
  if mid is null or mid < 0 then
    raise exception 'Geçersiz mesaj';
  end if;
  if not exists (select 1 from public.channels c
                 where c.id = cid and c.kind = 'text' and public.is_member(c.server_id)) then
    raise exception 'Kanal bulunamadı';
  end if;

  insert into public.channel_reads as r (user_id, channel_id, last_read_id)
  values (auth.uid(), cid, mid)
  on conflict (user_id, channel_id)
  do update set last_read_id = greatest(r.last_read_id, excluded.last_read_id);
end;
$$;

revoke all on function public.unread_counts() from public, anon;
revoke all on function public.mark_read(uuid, bigint) from public, anon;
grant execute on function public.unread_counts() to authenticated;
grant execute on function public.mark_read(uuid, bigint) to authenticated;

-- ========== 3) SUNUCU: AYRILMA, SİLME, AD DEĞİŞTİRME ==========

-- Sunucudan ayrıl. Sahip ayrılamaz (sunucuyu silebilir).
-- Kişinin o sunucudaki sesli durumu ve o sunucunun kanallarındaki okundu kayıtları da silinir:
-- yeniden katılırsa okunmamışlar katıldığı andan başlar. Eski mesajları yerinde kalır.
create or replace function public.leave_server(sid uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Giriş yapmalısın';
  end if;
  if not public.is_member(sid) then
    raise exception 'Sunucu bulunamadı';
  end if;
  if exists (select 1 from public.servers s where s.id = sid and s.owner_id = auth.uid()) then
    raise exception 'Sahibi olduğun sunucudan ayrılamazsın; istersen sunucuyu silebilirsin.';
  end if;

  delete from public.voice_states
   where user_id = auth.uid() and server_id = sid;
  delete from public.channel_reads r
   using public.channels c
   where r.channel_id = c.id and c.server_id = sid and r.user_id = auth.uid();
  delete from public.server_members
   where server_id = sid and user_id = auth.uid();
end;
$$;

-- Sunucuyu sil (yalnız sahip). Kanallar, mesajlar, üyelikler, voice_states ve
-- channel_reads kademeli (cascade) silinir.
create or replace function public.delete_server(sid uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Giriş yapmalısın';
  end if;
  if not public.is_member(sid) then
    raise exception 'Sunucu bulunamadı';
  end if;
  if not exists (select 1 from public.servers s where s.id = sid and s.owner_id = auth.uid()) then
    raise exception 'Bunu yalnız sunucu sahibi yapabilir';
  end if;

  delete from public.servers where id = sid;
end;
$$;

-- Sunucu adını değiştir (yalnız sahip), 1–40 karakter (tablo kısıtıyla aynı).
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
  if not exists (select 1 from public.servers s where s.id = sid and s.owner_id = auth.uid()) then
    raise exception 'Bunu yalnız sunucu sahibi yapabilir';
  end if;
  if char_length(yeni_ad) not between 1 and 40 then
    raise exception 'Sunucu adı 1–40 karakter olmalı';
  end if;

  update public.servers set name = yeni_ad where id = sid;
end;
$$;

revoke all on function public.leave_server(uuid) from public, anon;
revoke all on function public.delete_server(uuid) from public, anon;
revoke all on function public.rename_server(uuid, text) from public, anon;
grant execute on function public.leave_server(uuid) to authenticated;
grant execute on function public.delete_server(uuid) to authenticated;
grant execute on function public.rename_server(uuid, text) to authenticated;

-- ========== 4) KANAL: SİLME, YENİDEN ADLANDIRMA ==========

-- Doğrudan kanal silme kalkar: silme yalnız delete_channel ile (son yazılı kanal kuralı orada).
-- v0.2.1'de kanal silme arayüzü yok; eski istemci etkilenmez.
drop policy if exists channels_delete on public.channels;

-- Kanalı sil (yalnız sahip). Sunucunun son yazılı kanalı silinemez; son sesli kanal silinebilir.
-- Yarışa karşı: sunucunun SATIRI kilitlenir (kanal satırları değil), sayım kilitten SONRA yapılır.
-- İki kişi aynı anda iki ayrı yazılı kanalı silmeye kalksa ikincisi birincinin bitmesini bekler
-- ve kalan sayıyı doğru görür. Kanal silen tek yol bu fonksiyon (doğrudan silme politikası
-- kalktı); sunucu silinince kanallar cascade gider, delete_server de aynı satırı kilitler.
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
  if not exists (select 1 from public.servers s where s.id = sid and s.owner_id = auth.uid()) then
    raise exception 'Bunu yalnız sunucu sahibi yapabilir';
  end if;

  -- Sunucu satırını kilitle (yarış bu satırda sıraya girer)
  perform 1 from public.servers s where s.id = sid for update;
  if not found then
    raise exception 'Kanal bulunamadı';
  end if;

  -- Kilitten sonra yeniden bak: bu arada silinmiş olabilir
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

-- Kanalı yeniden adlandır (yalnız sahip), 1–30 karakter (tablo kısıtıyla aynı).
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
  if not exists (select 1 from public.servers s where s.id = sid and s.owner_id = auth.uid()) then
    raise exception 'Bunu yalnız sunucu sahibi yapabilir';
  end if;
  if char_length(yeni_ad) not between 1 and 30 then
    raise exception 'Kanal adı 1–30 karakter olmalı';
  end if;

  update public.channels set name = yeni_ad where id = cid;
end;
$$;

revoke all on function public.delete_channel(uuid) from public, anon;
revoke all on function public.rename_channel(uuid, text) from public, anon;
grant execute on function public.delete_channel(uuid) to authenticated;
grant execute on function public.rename_channel(uuid, text) to authenticated;

-- ========== 5) REALTIME YETKİLERİ ==========
-- 003'teki voice: kalıbı. Bozuk konu (uuid değilse) hata fırlatmaz, false döner.

-- "server:<sunucu uuid>": o sunucunun üyeleri
create or replace function public.can_access_server_topic(topic text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if topic is null
     or topic !~* '^server:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;
  return public.is_member(substring(topic from 8)::uuid); -- "server:" (7 karakter) sonrası
end;
$$;

-- "typing:<kanal uuid>": o kanal YAZILI kanal olmalı ve kişi o kanalın sunucusunun üyesi olmalı
create or replace function public.can_access_text_topic(topic text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  kanal_id uuid;
begin
  if topic is null
     or topic !~* '^typing:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;
  kanal_id := substring(topic from 8)::uuid; -- "typing:" (7 karakter) sonrası
  return exists (
    select 1 from public.channels c
    where c.id = kanal_id
      and c.kind = 'text'
      and public.is_member(c.server_id)
  );
end;
$$;

revoke all on function public.can_access_server_topic(text) from public, anon;
revoke all on function public.can_access_text_topic(text) from public, anon;
grant execute on function public.can_access_server_topic(text) to authenticated;
grant execute on function public.can_access_text_topic(text) to authenticated;

-- Sunucu olayları: üyeler ALIR. Gönderme politikası yok (yasak): yayını yalnız veritabanı
-- (aşağıdaki tetikleyiciler) gönderir, istemci sahte olay yollayamaz.
drop policy if exists server_receive on realtime.messages;
create policy server_receive on realtime.messages
  for select to authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and public.can_access_server_topic(realtime.topic())
  );

-- Yazıyor göstergesi: yalnız yayın (broadcast); üyeler alır ve gönderir. Veritabanına satır yazılmaz.
drop policy if exists typing_receive on realtime.messages;
create policy typing_receive on realtime.messages
  for select to authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and public.can_access_text_topic(realtime.topic())
  );
drop policy if exists typing_send on realtime.messages;
create policy typing_send on realtime.messages
  for insert to authenticated
  with check (
    realtime.messages.extension = 'broadcast'
    and public.can_access_text_topic(realtime.topic())
  );

-- ========== 6) TETİKLEYİCİLER: "degisti" OLAYI ==========
-- servers (güncelleme/silme), channels (ekleme/güncelleme/silme), server_members (silme)
-- değişince o sunucunun "server:<uuid>" konusuna "degisti" yayını gider; alan istemci
-- sunucu ve kanal listesini yeniden yükler.
-- Silmede tetikleyici değişiklikten ÖNCE (BEFORE) çalışır: olay, satır henüz yerindeyken gider.
-- Yayın gönderilemezse kullanıcının işlemi bozulmaz (hata yutulur; yedek: pencere odağında tazeleme).
create or replace function public.sunucu_olayi_gonder()
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

  if tg_table_name = 'servers' then
    sid := (satir ->> 'id')::uuid;
  else
    sid := (satir ->> 'server_id')::uuid;
    -- Sunucu silinirken kanallar ve üyelikler kademeli silinir; sunucunun kendi olayı zaten
    -- gitti, her satır için ayrıca olay yollamayalım.
    if tg_op = 'DELETE' and not exists (select 1 from public.servers s where s.id = sid) then
      return old;
    end if;
  end if;

  begin
    perform realtime.send(
      jsonb_build_object(
        'tablo', tg_table_name,
        'islem', tg_op,
        'server_id', sid,
        'channel_id', case when tg_table_name = 'channels' then satir ->> 'id' end,
        'user_id', case when tg_table_name = 'server_members' then satir ->> 'user_id' end
      ),
      'degisti',
      'server:' || sid::text,
      true
    );
  exception when others then
    null; -- yayın gitmedi: işlem yine de tamamlanır
  end;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return null; -- AFTER tetikleyicide dönüş değeri kullanılmaz
end;
$$;

revoke all on function public.sunucu_olayi_gonder() from public, anon;
grant execute on function public.sunucu_olayi_gonder() to authenticated;

drop trigger if exists servers_degisti on public.servers;
create trigger servers_degisti
  after update on public.servers
  for each row execute function public.sunucu_olayi_gonder();

drop trigger if exists servers_siliniyor on public.servers;
create trigger servers_siliniyor
  before delete on public.servers
  for each row execute function public.sunucu_olayi_gonder();

drop trigger if exists channels_degisti on public.channels;
create trigger channels_degisti
  after insert or update on public.channels
  for each row execute function public.sunucu_olayi_gonder();

drop trigger if exists channels_siliniyor on public.channels;
create trigger channels_siliniyor
  before delete on public.channels
  for each row execute function public.sunucu_olayi_gonder();

drop trigger if exists server_members_siliniyor on public.server_members;
create trigger server_members_siliniyor
  before delete on public.server_members
  for each row execute function public.sunucu_olayi_gonder();
