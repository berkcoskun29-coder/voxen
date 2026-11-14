-- 009: Emoji tepkileri, yanıtlama, sabitleme (v0.7.0).
-- Bu dosyada:
--  1) Yanıtlama: messages.reply_to ve dm_messages.reply_to (nullable, on delete set null) +
--     INSERT politikalarında "yanıtlanan mesaj aynı kanalda/DM'de" denetimi (reply_ok, dm_reply_ok)
--  2) dm_messages.kind: yeni tür 'pin' (DM'de "berk bir mesajı sabitledi." sistem satırı; yalnız RPC yazar).
--     edit/delete_dm_message artık kind <> 'text' olan her satırı reddeder (call ve pin)
--  3) Tepkiler: message_reactions, dm_message_reactions (8 sabit emoji) + react_message, react_dm_message
--  4) Sabitleme: message_pins, dm_message_pins + can_pin (yetki tek yerde), pin_message, pin_dm_message
--  5) Tetikleyiciler: tepki/sabit değişince "tepki"/"sabit" yayını (kanal: server:<sunucu>, DM: iki tarafın
--     user:<uid> konusu; yeni abonelik yok). Mesaj yumuşak silinince tepkileri ve sabiti silinir.
--
-- Hata kodları (istemci src/data/reactions.js Türkçeye çevirir): NOT_ALLOWED, BLOCKED_DM, PIN_LIMIT.
-- Engel bilgisi sızmaz (007 gibi): engelleyen BLOCKED_DM, engellenen NOT_ALLOWED alır.
--
-- Uyumluluk (v0.6.0):
--  - messages ve dm_messages'a yalnız nullable reply_to eklenir; eski istemci göndermez (null = serbest).
--  - Sabit ve tepki AYRI tablolarda: mesaj satırları güncellenmez, eski istemcilere boş UPDATE olayı gitmez.
--  - Kanala sistem satırı yazılmaz (messages'a INSERT yok). DM 'pin' satırı eski istemcide düz yazı görünür.
--  - dm_list, unread_counts, edit_message, delete_message değişmez. "tepki"/"sabit" yayınlarını eski istemci
--    dinlemez (yalnız "degisti" ve "arama" olaylarına abone).

-- ========== 1) YANITLAMA ==========

alter table public.messages add column if not exists reply_to bigint references public.messages(id) on delete set null;
alter table public.dm_messages add column if not exists reply_to bigint references public.dm_messages(id) on delete set null;

-- Yanıtlanan mesaj gerçekten silinince (kanal/sunucu silme) "set null" bu indeksle hızlı bulur
create index if not exists messages_reply_to_idx on public.messages (reply_to) where reply_to is not null;
create index if not exists dm_messages_reply_to_idx on public.dm_messages (reply_to) where reply_to is not null;

-- Yanıt geçerli mi: yanıt yok (null) ya da yanıtlanan mesaj AYNI kanalda ve silinmemiş.
-- security definer: politika içinden messages'a bakarken RLS döngüsüne girmez.
create or replace function public.reply_ok(rid bigint, cid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select rid is null or exists (
    select 1 from public.messages m
    where m.id = rid and m.channel_id = cid and m.deleted_at is null
  );
$$;

-- DM karşılığı: aynı konuşmada, silinmemiş, düz mesaj (arama/sabit satırına yanıt verilmez)
create or replace function public.dm_reply_ok(rid bigint, tid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select rid is null or exists (
    select 1 from public.dm_messages m
    where m.id = rid and m.thread_id = tid and m.deleted_at is null and m.kind = 'text'
  );
$$;

revoke all on function public.reply_ok(bigint, uuid) from public, anon;
revoke all on function public.dm_reply_ok(bigint, uuid) from public, anon;
grant execute on function public.reply_ok(bigint, uuid) to authenticated;
grant execute on function public.dm_reply_ok(bigint, uuid) to authenticated;

-- Gönderme yine doğrudan INSERT. Şartlar 006 ile AYNI; tek ek: yanıt geçerli olmalı.
drop policy if exists messages_insert on public.messages;
create policy messages_insert on public.messages
  for insert to authenticated
  with check (
    author_id = auth.uid()
    and deleted_at is null
    and edited_at is null
    and exists (select 1 from public.channels c
                where c.id = channel_id and public.is_member(c.server_id))
    and public.reply_ok(reply_to, channel_id)
  );

-- DM: şartlar 008 ile AYNI; tek ek: yanıt geçerli olmalı.
drop policy if exists dm_messages_insert on public.dm_messages;
create policy dm_messages_insert on public.dm_messages
  for insert to authenticated
  with check (
    author_id = auth.uid()
    and deleted_at is null
    and edited_at is null
    and kind = 'text'
    and public.can_send_dm(thread_id)
    and public.dm_reply_ok(reply_to, thread_id)
  );

-- ========== 2) dm_messages.kind: 'pin' ==========

-- 008'deki kısıt sütunla birlikte adsız eklendi (Postgres'in adı: dm_messages_kind_check);
-- yine de tanımına bakarak buluruz (006'daki içerik kısıtı kalıbı).
do $$
declare
  k record;
begin
  for k in
    select conname from pg_constraint
    where conrelid = 'public.dm_messages'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%kind%'
  loop
    execute format('alter table public.dm_messages drop constraint %I', k.conname);
  end loop;
end;
$$;

alter table public.dm_messages drop constraint if exists dm_messages_kind_check;
alter table public.dm_messages add constraint dm_messages_kind_check check (kind in ('text','call','pin'));

-- 008'deki edit_dm_message: tek fark, düz mesaj dışındaki her satır (call, pin) düzenlenemez.
create or replace function public.edit_dm_message(id bigint, yeni text)
returns public.dm_messages
language plpgsql
security definer
set search_path = public
as $$
declare
  m public.dm_messages;
  t public.dm_threads;
  diger uuid;
  metin text := btrim(coalesce(yeni, ''), E' \t\r\n');
begin
  if auth.uid() is null then
    raise exception 'NOT_ALLOWED';
  end if;

  -- Satırı kilitle: aynı anda silme/düzenleme yarışmasın
  select * into m from public.dm_messages dm where dm.id = edit_dm_message.id for update;
  if not found or m.deleted_at is not null or m.author_id <> auth.uid()
     or m.kind <> 'text'
     or not public.is_dm_participant(m.thread_id) then
    raise exception 'NOT_ALLOWED';
  end if;

  select * into t from public.dm_threads th where th.id = m.thread_id;
  diger := case when t.user_a = auth.uid() then t.user_b else t.user_a end;
  if exists (select 1 from public.blocks bl where bl.blocker = auth.uid() and bl.blocked = diger) then
    raise exception 'BLOCKED_DM';
  end if;
  if public.engel_var(t.user_a, t.user_b) then
    raise exception 'NOT_ALLOWED';
  end if;
  if length(metin) not between 1 and 2000 then
    raise exception 'NOT_ALLOWED';
  end if;

  update public.dm_messages dm
     set content = metin, edited_at = now()
   where dm.id = edit_dm_message.id
  returning * into m;
  return m;
end;
$$;

-- 008'deki delete_dm_message: tek fark, düz mesaj dışındaki her satır (call, pin) silinemez.
create or replace function public.delete_dm_message(id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  m public.dm_messages;
begin
  if auth.uid() is null then
    raise exception 'NOT_ALLOWED';
  end if;

  select * into m from public.dm_messages dm where dm.id = delete_dm_message.id for update;
  if not found or m.deleted_at is not null or m.author_id <> auth.uid()
     or m.kind <> 'text'
     or not public.is_dm_participant(m.thread_id) then
    raise exception 'NOT_ALLOWED';
  end if;

  update public.dm_messages dm
     set content = '', deleted_at = now()
   where dm.id = delete_dm_message.id;
end;
$$;

revoke all on function public.edit_dm_message(bigint, text) from public, anon;
revoke all on function public.delete_dm_message(bigint) from public, anon;
grant execute on function public.edit_dm_message(bigint, text) to authenticated;
grant execute on function public.delete_dm_message(bigint) to authenticated;

-- ========== 3) TEPKİLER ==========

-- İzin verilen 8 emoji: TEK kaynak (tablo kısıtları ve RPC'ler bunu kullanır).
-- İstemcideki liste (src/data/reactions.js EMOJILER) ile AYNI olmalı. ❤️ = U+2764 U+FE0F.
create or replace function public.tepki_gecerli(e text)
returns boolean
language sql
immutable
security definer
set search_path = public
as $$
  select coalesce(e in ('👍','👎','😂','❤️','😮','😢','🔥','🎉'), false);
$$;

revoke all on function public.tepki_gecerli(text) from public, anon;
grant execute on function public.tepki_gecerli(text) to authenticated;

-- Kişi başına, mesaj başına aynı emoji bir kez (birincil anahtar). Mesaj gerçekten silinince
-- tepkiler de gider (cascade); yumuşak silmede tetikleyici siler (bölüm 5).
create table if not exists public.message_reactions (
  message_id bigint not null references public.messages(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  emoji text not null check (public.tepki_gecerli(emoji)),
  created_at timestamptz not null default now(),
  primary key (message_id, user_id, emoji)
);

create table if not exists public.dm_message_reactions (
  message_id bigint not null references public.dm_messages(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  emoji text not null check (public.tepki_gecerli(emoji)),
  created_at timestamptz not null default now(),
  primary key (message_id, user_id, emoji)
);

alter table public.message_reactions enable row level security;
alter table public.dm_message_reactions enable row level security;

-- Kanal tepkisini yalnız o sunucunun üyeleri görür. Yazma politikası yok: yalnız RPC.
drop policy if exists message_reactions_select on public.message_reactions;
create policy message_reactions_select on public.message_reactions
  for select to authenticated
  using (
    exists (select 1 from public.messages m
            join public.channels c on c.id = m.channel_id
            where m.id = message_id and public.is_member(c.server_id))
  );

-- DM tepkisini yalnız iki taraf görür
drop policy if exists dm_message_reactions_select on public.dm_message_reactions;
create policy dm_message_reactions_select on public.dm_message_reactions
  for select to authenticated
  using (
    exists (select 1 from public.dm_messages m
            where m.id = message_id and public.is_dm_participant(m.thread_id))
  );

-- Kanal mesajına tepki ekler (ekle = true) ya da kendi tepkini kaldırır (ekle = false).
-- İki yön de tekrarlanabilir: zaten varsa/yoksa sessizce geçer (çift tık, iki cihaz).
-- Yalnız sunucu üyesi, silinmemiş mesajda, 8 emojiden biriyle. Başka her durumda NOT_ALLOWED
-- (yabancı mesajın varlığını öğrenmez).
-- Satır paylaşımlı kilitlenir (for share): aynı anda yumuşak silme (delete_message, for update) önce
-- biterse burada silinmiş görülür; tepki silinmiş mesajda yetim kalmaz.
create or replace function public.react_message(mid bigint, tepki text, ekle boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  ben uuid := auth.uid();
  m public.messages;
begin
  if ben is null or ekle is null or tepki is null or not public.tepki_gecerli(tepki) then
    raise exception 'NOT_ALLOWED';
  end if;

  select * into m from public.messages ms where ms.id = react_message.mid for share;
  if not found or m.deleted_at is not null
     or not exists (select 1 from public.channels c
                    where c.id = m.channel_id and public.is_member(c.server_id)) then
    raise exception 'NOT_ALLOWED';
  end if;

  if ekle then
    insert into public.message_reactions (message_id, user_id, emoji)
    values (m.id, ben, tepki)
    on conflict (message_id, user_id, emoji) do nothing;
  else
    delete from public.message_reactions r
     where r.message_id = m.id and r.user_id = ben and r.emoji = tepki;
  end if;
end;
$$;

-- DM mesajına tepki. Yalnız konuşmanın tarafı, silinmemiş DÜZ mesajda (arama ve sabit satırına değil).
-- Engel yalnız eklemeyi durdurur (kod engelleyene göre: BLOCKED_DM / NOT_ALLOWED); kendi tepkini
-- kaldırmak engelde de serbest (kişi kendi mesajını da silebiliyor).
create or replace function public.react_dm_message(mid bigint, tepki text, ekle boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  ben uuid := auth.uid();
  m public.dm_messages;
  t public.dm_threads;
  diger uuid;
begin
  if ben is null or ekle is null or tepki is null or not public.tepki_gecerli(tepki) then
    raise exception 'NOT_ALLOWED';
  end if;

  select * into m from public.dm_messages dm where dm.id = react_dm_message.mid for share;
  if not found or m.deleted_at is not null or m.kind <> 'text'
     or not public.is_dm_participant(m.thread_id) then
    raise exception 'NOT_ALLOWED';
  end if;

  if ekle then
    select * into t from public.dm_threads th where th.id = m.thread_id;
    diger := case when t.user_a = ben then t.user_b else t.user_a end;
    if exists (select 1 from public.blocks bl where bl.blocker = ben and bl.blocked = diger) then
      raise exception 'BLOCKED_DM';
    end if;
    if public.engel_var(t.user_a, t.user_b) then
      raise exception 'NOT_ALLOWED';
    end if;
    insert into public.dm_message_reactions (message_id, user_id, emoji)
    values (m.id, ben, tepki)
    on conflict (message_id, user_id, emoji) do nothing;
  else
    delete from public.dm_message_reactions r
     where r.message_id = m.id and r.user_id = ben and r.emoji = tepki;
  end if;
end;
$$;

revoke all on function public.react_message(bigint, text, boolean) from public, anon;
revoke all on function public.react_dm_message(bigint, text, boolean) from public, anon;
grant execute on function public.react_message(bigint, text, boolean) to authenticated;
grant execute on function public.react_dm_message(bigint, text, boolean) to authenticated;

-- ========== 4) SABİTLEME ==========

-- Mesaj başına tek satır. Konuşma sütunu (channel_id / thread_id) liste ve 50 sınırı için.
create table if not exists public.message_pins (
  message_id bigint primary key references public.messages(id) on delete cascade,
  channel_id uuid not null references public.channels(id) on delete cascade,
  pinned_by uuid references auth.users(id) on delete set null,
  pinned_at timestamptz not null default now()
);

create table if not exists public.dm_message_pins (
  message_id bigint primary key references public.dm_messages(id) on delete cascade,
  thread_id uuid not null references public.dm_threads(id) on delete cascade,
  pinned_by uuid references auth.users(id) on delete set null,
  pinned_at timestamptz not null default now()
);

-- Liste (en yeni sabit üstte) ve sayım
create index if not exists message_pins_channel_idx on public.message_pins (channel_id, pinned_at desc);
create index if not exists dm_message_pins_thread_idx on public.dm_message_pins (thread_id, pinned_at desc);

alter table public.message_pins enable row level security;
alter table public.dm_message_pins enable row level security;

-- Okuma: kanalda sunucu üyeleri, DM'de iki taraf. Yazma politikası yok: yalnız RPC.
drop policy if exists message_pins_select on public.message_pins;
create policy message_pins_select on public.message_pins
  for select to authenticated
  using (
    exists (select 1 from public.channels c
            where c.id = channel_id and public.is_member(c.server_id))
  );

drop policy if exists dm_message_pins_select on public.dm_message_pins;
create policy dm_message_pins_select on public.dm_message_pins
  for select to authenticated
  using (public.is_dm_participant(thread_id));

-- Kanalda sabitleme yetkisi: TEK yer. Şimdilik yalnız sunucu sahibi; v0.11.0'da roller buraya eklenecek.
-- (İstemci de çağırabilir: yalnız kendi yetkisini öğrenir.)
create or replace function public.can_pin(cid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.channels c
    join public.servers s on s.id = c.server_id
    where c.id = cid and s.owner_id = auth.uid()
  );
$$;

-- Kanal mesajını sabitler (sabitle = true) ya da sabitlemeyi kaldırır (false). İki yön tekrarlanabilir.
-- Yalnız üye ve yetkili (can_pin), silinmemiş mesajda. Kanal başına en fazla 50: PIN_LIMIT.
-- Sayım + ekleme kanal başına danışma kilidiyle sıraya girer (iki kişi aynı anda 50.'yi geçemez).
-- Kanala sistem satırı YAZILMAZ (eski istemcide sahte mesaj gibi görünürdü); 📌 işareti ve liste yeter.
create or replace function public.pin_message(mid bigint, sabitle boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  ben uuid := auth.uid();
  m public.messages;
begin
  if ben is null or sabitle is null then
    raise exception 'NOT_ALLOWED';
  end if;

  select * into m from public.messages ms where ms.id = pin_message.mid for share;
  if not found or m.deleted_at is not null
     or not exists (select 1 from public.channels c
                    where c.id = m.channel_id and public.is_member(c.server_id)) then
    raise exception 'NOT_ALLOWED';
  end if;
  -- Yetki yalnız burada sorulur (bkz. can_pin)
  if not public.can_pin(m.channel_id) then
    raise exception 'NOT_ALLOWED';
  end if;

  if not sabitle then
    delete from public.message_pins p where p.message_id = m.id;
    return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('pin:' || m.channel_id::text, 0));
  if exists (select 1 from public.message_pins p where p.message_id = m.id) then
    return; -- zaten sabit
  end if;
  if (select count(*) from public.message_pins p where p.channel_id = m.channel_id) >= 50 then
    raise exception 'PIN_LIMIT';
  end if;

  insert into public.message_pins (message_id, channel_id, pinned_by)
  values (m.id, m.channel_id, ben);
end;
$$;

-- DM mesajını sabitler/kaldırır. İki taraf da yapabilir; yalnız silinmemiş DÜZ mesaj.
-- Engelde ikisi de yapılamaz (kod engelleyene göre: BLOCKED_DM / NOT_ALLOWED). Konuşma başına en fazla 50.
-- Sabitleyince sohbete sistem satırı düşer: kind 'pin', yazarı sabitleyen, "berk bir mesajı sabitledi."
-- (eski istemcide düz yazı görünür; düzenlenemez, silinemez). Kaldırmak satır üretmez.
create or replace function public.pin_dm_message(mid bigint, sabitle boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  ben uuid := auth.uid();
  m public.dm_messages;
  t public.dm_threads;
  diger uuid;
  ad text;
begin
  if ben is null or sabitle is null then
    raise exception 'NOT_ALLOWED';
  end if;

  select * into m from public.dm_messages dm where dm.id = pin_dm_message.mid for share;
  if not found or m.deleted_at is not null or m.kind <> 'text'
     or not public.is_dm_participant(m.thread_id) then
    raise exception 'NOT_ALLOWED';
  end if;

  select * into t from public.dm_threads th where th.id = m.thread_id;
  diger := case when t.user_a = ben then t.user_b else t.user_a end;
  if exists (select 1 from public.blocks bl where bl.blocker = ben and bl.blocked = diger) then
    raise exception 'BLOCKED_DM';
  end if;
  if public.engel_var(t.user_a, t.user_b) then
    raise exception 'NOT_ALLOWED';
  end if;

  if not sabitle then
    delete from public.dm_message_pins p where p.message_id = m.id;
    return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('dmpin:' || m.thread_id::text, 0));
  if exists (select 1 from public.dm_message_pins p where p.message_id = m.id) then
    return; -- zaten sabit (sistem satırı ikinci kez yazılmaz)
  end if;
  if (select count(*) from public.dm_message_pins p where p.thread_id = m.thread_id) >= 50 then
    raise exception 'PIN_LIMIT';
  end if;

  insert into public.dm_message_pins (message_id, thread_id, pinned_by)
  values (m.id, m.thread_id, ben);

  select p.username into ad from public.profiles p where p.id = ben;
  insert into public.dm_messages (thread_id, author_id, content, kind)
  values (m.thread_id, ben, coalesce(ad, 'Biri') || ' bir mesajı sabitledi.', 'pin');
end;
$$;

revoke all on function public.can_pin(uuid) from public, anon;
revoke all on function public.pin_message(bigint, boolean) from public, anon;
revoke all on function public.pin_dm_message(bigint, boolean) from public, anon;
grant execute on function public.can_pin(uuid) to authenticated;
grant execute on function public.pin_message(bigint, boolean) to authenticated;
grant execute on function public.pin_dm_message(bigint, boolean) to authenticated;

-- ========== 5) TETİKLEYİCİLER ==========

-- Tepki eklenince/kalkınca yayın: kanal tepkisi o sunucunun "server:<uuid>" konusuna (üyeler alır),
-- DM tepkisi iki tarafın "user:<uid>" konusuna. Olay adı "tepki".
-- Yük: { channel_id | thread_id, message_id, emoji, user_id, islem: 'INSERT' | 'DELETE' }.
-- Mesaj yoksa (kanal/sunucu silinirken cascade) ya da yumuşak silindiyse olay gönderilmez: istemci
-- mesajı zaten kaldırır. Yayın gönderilemezse işlem bozulmaz (hata yutulur).
create or replace function public.tepki_olayi_gonder()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  satir jsonb;
  mid bigint;
  sid uuid;
  kid uuid;
  tid uuid;
  a uuid;
  b uuid;
  kisi uuid;
begin
  if tg_op = 'DELETE' then
    satir := to_jsonb(old);
  else
    satir := to_jsonb(new);
  end if;
  mid := (satir ->> 'message_id')::bigint;

  if tg_table_name = 'message_reactions' then
    select c.server_id, m.channel_id into sid, kid
      from public.messages m
      join public.channels c on c.id = m.channel_id
     where m.id = mid and m.deleted_at is null;
    if not found then
      return null;
    end if;
    begin
      perform realtime.send(
        jsonb_build_object(
          'channel_id', kid,
          'message_id', mid,
          'emoji', satir ->> 'emoji',
          'user_id', satir ->> 'user_id',
          'islem', tg_op
        ),
        'tepki',
        'server:' || sid::text,
        true
      );
    exception when others then
      null; -- yayın gitmedi: işlem yine de tamamlanır
    end;
  else
    select m.thread_id, t.user_a, t.user_b into tid, a, b
      from public.dm_messages m
      join public.dm_threads t on t.id = m.thread_id
     where m.id = mid and m.deleted_at is null;
    if not found then
      return null;
    end if;
    foreach kisi in array array[a, b] loop
      begin
        perform realtime.send(
          jsonb_build_object(
            'thread_id', tid,
            'message_id', mid,
            'emoji', satir ->> 'emoji',
            'user_id', satir ->> 'user_id',
            'islem', tg_op
          ),
          'tepki',
          'user:' || kisi::text,
          true
        );
      exception when others then
        null;
      end;
    end loop;
  end if;

  return null; -- AFTER tetikleyicide dönüş değeri kullanılmaz
end;
$$;

-- Sabit eklenince/kalkınca yayın (aynı konular). Olay adı "sabit".
-- Yük: { channel_id | thread_id, message_id, islem: 'INSERT' | 'DELETE', pinned_by }.
create or replace function public.sabit_olayi_gonder()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  satir jsonb;
  mid bigint;
  sid uuid;
  kid uuid;
  tid uuid;
  a uuid;
  b uuid;
  kisi uuid;
begin
  if tg_op = 'DELETE' then
    satir := to_jsonb(old);
  else
    satir := to_jsonb(new);
  end if;
  mid := (satir ->> 'message_id')::bigint;

  if tg_table_name = 'message_pins' then
    select c.server_id, m.channel_id into sid, kid
      from public.messages m
      join public.channels c on c.id = m.channel_id
     where m.id = mid and m.deleted_at is null;
    if not found then
      return null;
    end if;
    begin
      perform realtime.send(
        jsonb_build_object(
          'channel_id', kid,
          'message_id', mid,
          'islem', tg_op,
          'pinned_by', satir ->> 'pinned_by'
        ),
        'sabit',
        'server:' || sid::text,
        true
      );
    exception when others then
      null;
    end;
  else
    select m.thread_id, t.user_a, t.user_b into tid, a, b
      from public.dm_messages m
      join public.dm_threads t on t.id = m.thread_id
     where m.id = mid and m.deleted_at is null;
    if not found then
      return null;
    end if;
    foreach kisi in array array[a, b] loop
      begin
        perform realtime.send(
          jsonb_build_object(
            'thread_id', tid,
            'message_id', mid,
            'islem', tg_op,
            'pinned_by', satir ->> 'pinned_by'
          ),
          'sabit',
          'user:' || kisi::text,
          true
        );
      exception when others then
        null;
      end;
    end loop;
  end if;

  return null;
end;
$$;

-- Mesaj yumuşak silinince (deleted_at boştan doluya) tepkileri ve sabiti de silinir.
-- Gerçek silmede bunu yabancı anahtarlar (on delete cascade) yapar.
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
  else
    delete from public.dm_message_reactions r where r.message_id = new.id;
    delete from public.dm_message_pins p where p.message_id = new.id;
  end if;
  return null;
end;
$$;

revoke all on function public.tepki_olayi_gonder() from public, anon;
revoke all on function public.sabit_olayi_gonder() from public, anon;
revoke all on function public.mesaj_silinince_temizle() from public, anon;
grant execute on function public.tepki_olayi_gonder() to authenticated;
grant execute on function public.sabit_olayi_gonder() to authenticated;
grant execute on function public.mesaj_silinince_temizle() to authenticated;

drop trigger if exists message_reactions_degisti on public.message_reactions;
create trigger message_reactions_degisti
  after insert or delete on public.message_reactions
  for each row execute function public.tepki_olayi_gonder();

drop trigger if exists dm_message_reactions_degisti on public.dm_message_reactions;
create trigger dm_message_reactions_degisti
  after insert or delete on public.dm_message_reactions
  for each row execute function public.tepki_olayi_gonder();

drop trigger if exists message_pins_degisti on public.message_pins;
create trigger message_pins_degisti
  after insert or delete on public.message_pins
  for each row execute function public.sabit_olayi_gonder();

drop trigger if exists dm_message_pins_degisti on public.dm_message_pins;
create trigger dm_message_pins_degisti
  after insert or delete on public.dm_message_pins
  for each row execute function public.sabit_olayi_gonder();

drop trigger if exists messages_silinince on public.messages;
create trigger messages_silinince
  after update of deleted_at on public.messages
  for each row when (old.deleted_at is null and new.deleted_at is not null)
  execute function public.mesaj_silinince_temizle();

drop trigger if exists dm_messages_silinince on public.dm_messages;
create trigger dm_messages_silinince
  after update of deleted_at on public.dm_messages
  for each row when (old.deleted_at is null and new.deleted_at is not null)
  execute function public.mesaj_silinince_temizle();
