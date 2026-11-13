-- 008: DM'den sesli arama (v0.5.0).
-- Bu dosyada:
--  1) dm_calls tablosu: konuşma başına aynı anda en fazla bir bitmemiş arama
--  2) dm_messages.kind ('text' | 'call'): arama kayıt satırlarını yalnız RPC yazar;
--     doğrudan INSERT yalnız 'text'; edit/delete_dm_message 'call' satırını reddeder
--  3) RPC'ler: start_dm_call, answer_dm_call, end_dm_call, ping_dm_call (+ içeride arama_kapat)
--  4) Tetikleyici: dm_calls'ta durum değişince iki tarafın "user:<uid>" konusuna "arama" yayını
--  5) Realtime yetkileri: private "dm-voice:<arama uuid>" yalnız iki tarafa, yalnız arama bitmemişken
--
-- Hata kodları (istemci src/data/calls.js Türkçeye çevirir): NOT_ALLOWED, BLOCKED_DM, BUSY, ALREADY_IN_CALL.
-- Engel bilgisi sızmaz (007 gibi): engelleyen BLOCKED_DM, engellenen NOT_ALLOWED alır.
-- Bayat arama: last_seen_at 60 sn'den eskiyse arama bitmiş sayılır (meşgul saymaz, yeni aramada kapanır).
-- Çalan (ringing) arama ayrıca created_at 40 sn'den eskiyse de bayattır (arayanın 30 sn sayacı hiç
-- çalışmadıysa: ör. pencere çalarken kapandı). Bu kural start_dm_call'ın temizliğinde uygulanır.
--
-- Uyumluluk (v0.4.x): dm_messages.kind varsayılanı 'text'; eski istemci sütunu bilmez, arama satırını
-- düz yazı olarak gösterir ("📞 Cevapsız arama"). dm_list ve unread_counts değişmez.

-- ========== 1) dm_calls ==========

create table if not exists public.dm_calls (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.dm_threads(id) on delete cascade,
  caller uuid not null references auth.users(id) on delete cascade,
  callee uuid not null references auth.users(id) on delete cascade,
  status text not null default 'ringing' check (status in ('ringing','active','ended')),
  created_at timestamptz not null default now(),
  answered_at timestamptz,
  ended_at timestamptz,
  last_seen_at timestamptz not null default now(),
  -- Bitiş nedeni (yalnız ended iken dolu): arayan "reddetti" / "cevap yok" ayrımını olaydan okur
  end_reason text check (end_reason in ('cancel','decline','timeout','hangup','lost')),
  constraint dm_calls_kendini check (caller <> callee)
);

-- Bir konuşmada aynı anda bitmemiş en fazla bir arama
create unique index if not exists dm_calls_acik_tek on public.dm_calls (thread_id) where status <> 'ended';
-- Meşgul ve bayat denetimi: kişinin bitmemiş aramaları
create index if not exists dm_calls_caller_acik on public.dm_calls (caller) where status <> 'ended';
create index if not exists dm_calls_callee_acik on public.dm_calls (callee) where status <> 'ended';

alter table public.dm_calls enable row level security;

-- Yalnız iki taraf okur. Ekleme/güncelleme/silme politikası yok: hepsi RPC ile.
drop policy if exists dm_calls_select on public.dm_calls;
create policy dm_calls_select on public.dm_calls
  for select to authenticated
  using (caller = auth.uid() or callee = auth.uid());

-- ========== 2) dm_messages.kind ==========

-- Sabit varsayılanlı sütun eklemek tabloyu yeniden yazmaz; var olan satırlar 'text' olur.
alter table public.dm_messages
  add column if not exists kind text not null default 'text' check (kind in ('text','call'));

-- Doğrudan INSERT yalnız düz mesaj: arama satırını istemci yazamaz. Diğer şartlar 007 ile AYNI.
drop policy if exists dm_messages_insert on public.dm_messages;
create policy dm_messages_insert on public.dm_messages
  for insert to authenticated
  with check (
    author_id = auth.uid()
    and deleted_at is null
    and edited_at is null
    and kind = 'text'
    and public.can_send_dm(thread_id)
  );

-- 007'deki edit_dm_message: tek fark, arama satırı (kind = 'call') düzenlenemez.
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
     or m.kind = 'call'
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

-- 007'deki delete_dm_message: tek fark, arama satırı (kind = 'call') silinemez.
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
     or m.kind = 'call'
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

-- ========== 3) RPC'LER ==========

-- Aramayı bitirir ve kayıt satırını yazar. YALNIZ veritabanı içinde (end_dm_call ve start_dm_call'ın
-- bayat temizliği) kullanılır; istemciye AÇIK DEĞİL (yetki denetimi çağırandadır).
-- Tek kez: satır kilitlenir; zaten 'ended' ise hiçbir şey yapmaz (çift end çağrısı ikinci satırı yazmaz).
-- Bayat aramada bitiş zamanı son görülme anıdır (süre şişmesin).
-- Kayıt satırının yazarı arayandır: aranan için okunmamış sayılır, last_message_at tetikleyiciyle güncellenir.
create or replace function public.arama_kapat(cid uuid, neden text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  arama public.dm_calls;
  bitis timestamptz;
  sure int;
  metin text;
begin
  select * into arama from public.dm_calls dc where dc.id = cid for update;
  if not found or arama.status = 'ended' then
    return;
  end if;

  bitis := now();
  if arama.last_seen_at < now() - interval '60 seconds' then
    bitis := greatest(arama.last_seen_at, coalesce(arama.answered_at, arama.created_at));
  end if;

  update public.dm_calls dc
     set status = 'ended', ended_at = bitis, end_reason = neden
   where dc.id = cid;

  if arama.answered_at is null then
    metin := '📞 Cevapsız arama';
  else
    sure := greatest(0, floor(extract(epoch from (bitis - arama.answered_at)))::int);
    if sure >= 3600 then
      -- s:dd:ss
      metin := '📞 Arama · ' || (sure / 3600)::text || ':'
               || lpad(((sure % 3600) / 60)::text, 2, '0') || ':' || lpad((sure % 60)::text, 2, '0');
    else
      -- mm:ss
      metin := '📞 Arama · ' || lpad((sure / 60)::text, 2, '0') || ':' || lpad((sure % 60)::text, 2, '0');
    end if;
  end if;

  insert into public.dm_messages (thread_id, author_id, content, kind)
  values (arama.thread_id, arama.caller, metin, 'call');
end;
$$;

revoke all on function public.arama_kapat(uuid, text) from public, anon, authenticated;

-- Arama başlatır. Dönüş: aramanın satırı (istemci id ve status'u kullanır).
--  - Çağıran konuşmanın tarafı olmalı. Engel (iki yönde de) varsa: engelleyen BLOCKED_DM,
--    engellenen NOT_ALLOWED (007'deki gizli kodlar).
--  - İki tarafın bayat aramaları önce bitirilir.
--  - Bu konuşmada karşı taraftan ÇALAN bir arama varsa yeni arama açılmaz, o arama kabul edilir
--    (iki kişi aynı anda birbirini ararsa ikisi de konuşmaya girer). Kendi çalan aramam varsa o döner.
--  - İki taraf arasında zaten süren (active, bayat olmayan) bir arama varsa ALREADY_IN_CALL.
--  - Karşı tarafın başka bir konuşmada bitmemiş (bayat olmayan) araması varsa BUSY.
--  Bayat: last_seen_at 60 sn'den eski ya da çalıyor ve created_at 40 sn'den eski. Bayatlar en başta
--  bitirildiği için aşağıdaki birleştirme ve BUSY denetimleri yalnız bayat olmayan aramaları görür.
-- Yarış: iki kişilik kilit (007 kalıbı, 'dmcall:' ön eki) kişi başına alınır, uuid sırasıyla
-- (kilitlenme olmaz). Böylece hem karşılıklı arama hem de iki farklı kişinin aynı kişiyi aynı anda
-- araması sıraya girer: ikincisi birincinin aramasını görür (kabul eder ya da BUSY alır).
create or replace function public.start_dm_call(tid uuid)
returns public.dm_calls
language plpgsql
security definer
set search_path = public
as $$
declare
  ben uuid := auth.uid();
  konusma public.dm_threads;
  diger uuid;
  arama public.dm_calls;
  eski uuid;
begin
  if ben is null then
    raise exception 'NOT_ALLOWED';
  end if;

  select * into konusma from public.dm_threads th where th.id = start_dm_call.tid;
  if not found or (konusma.user_a <> ben and konusma.user_b <> ben) then
    raise exception 'NOT_ALLOWED';
  end if;
  diger := case when konusma.user_a = ben then konusma.user_b else konusma.user_a end;

  -- Engel: can_send_dm ile aynı kural; kod engelleyene göre seçilir
  if exists (select 1 from public.blocks bl where bl.blocker = ben and bl.blocked = diger) then
    raise exception 'BLOCKED_DM';
  end if;
  if not public.can_send_dm(konusma.id) then
    raise exception 'NOT_ALLOWED';
  end if;

  -- Kişi başına kilit, küçük uuid önce (user_a < user_b)
  perform pg_advisory_xact_lock(hashtextextended('dmcall:' || konusma.user_a::text, 0));
  perform pg_advisory_xact_lock(hashtextextended('dmcall:' || konusma.user_b::text, 0));

  -- İki tarafın bayat aramalarını bitir (id sırasıyla: eşzamanlı temizlikler kilitlenmesin).
  -- Bayat: 60 sn'dir görülmeyen ya da 40 sn'den uzun süredir çalan (cevapsız kalmış) arama.
  for eski in
    select dc.id from public.dm_calls dc
     where dc.status <> 'ended'
       and (dc.last_seen_at < now() - interval '60 seconds'
            or (dc.status = 'ringing' and dc.created_at < now() - interval '40 seconds'))
       and (dc.caller in (ben, diger) or dc.callee in (ben, diger))
     order by dc.id
  loop
    perform public.arama_kapat(eski, 'lost');
  end loop;

  -- Bu konuşmada bitmemiş arama var mı?
  select * into arama from public.dm_calls dc
   where dc.thread_id = konusma.id and dc.status <> 'ended'
   for update;
  if found then
    -- Aramızda zaten süren bir konuşma var: yeni arama açılmaz, birleştirilmez
    if arama.status = 'active' then
      raise exception 'ALREADY_IN_CALL';
    end if;
    if arama.status = 'ringing' and arama.caller = diger then
      -- Karşı taraf da beni arıyordu: onun araması kabul edilir
      update public.dm_calls dc
         set status = 'active', answered_at = now(), last_seen_at = now()
       where dc.id = arama.id
      returning * into arama;
    end if;
    return arama; -- kabul edilen ya da kendi çalan aramam
  end if;

  -- Meşgul: karşı tarafın başka bir konuşmada bitmemiş araması (bayatlar yukarıda bitti)
  if exists (select 1 from public.dm_calls dc
             where dc.status <> 'ended' and (dc.caller = diger or dc.callee = diger)) then
    raise exception 'BUSY';
  end if;

  insert into public.dm_calls (thread_id, caller, callee)
  values (konusma.id, ben, diger)
  returning * into arama;
  return arama;
end;
$$;

-- Aramayı kabul eder: yalnız aranan, 'ringing' -> 'active'. Dönüş: aramanın satırı.
-- Zaten 'active' ise olduğu gibi döner (iki cihazdan kabul). Bitmiş ya da bayatsa satır 'ended'
-- olarak döner (bayatsa burada bitirilir); istemci status'a bakar.
-- Engel çalarken konduysa kabul edilemez (007'deki gizli kodlar).
create or replace function public.answer_dm_call(id uuid)
returns public.dm_calls
language plpgsql
security definer
set search_path = public
as $$
declare
  ben uuid := auth.uid();
  arama public.dm_calls;
begin
  if ben is null then
    raise exception 'NOT_ALLOWED';
  end if;

  select * into arama from public.dm_calls dc where dc.id = answer_dm_call.id for update;
  if not found or arama.callee <> ben then
    raise exception 'NOT_ALLOWED';
  end if;

  if exists (select 1 from public.blocks bl where bl.blocker = ben and bl.blocked = arama.caller) then
    raise exception 'BLOCKED_DM';
  end if;
  if public.engel_var(arama.caller, arama.callee) then
    raise exception 'NOT_ALLOWED';
  end if;

  if arama.status = 'ringing' and arama.last_seen_at < now() - interval '60 seconds' then
    perform public.arama_kapat(arama.id, 'lost');
    select * into arama from public.dm_calls dc where dc.id = answer_dm_call.id;
    return arama;
  end if;
  if arama.status <> 'ringing' then
    return arama;
  end if;

  update public.dm_calls dc
     set status = 'active', answered_at = now(), last_seen_at = now()
   where dc.id = answer_dm_call.id
  returning * into arama;
  return arama;
end;
$$;

-- Aramayı bitirir: iki taraf da çağırabilir. reason: 'cancel' | 'decline' | 'timeout' | 'hangup' | 'lost'.
-- Kayıt satırını arama_kapat tek kez yazar; zaten bitmişse sessizce geçer.
create or replace function public.end_dm_call(id uuid, reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  ben uuid := auth.uid();
  arama public.dm_calls;
begin
  if ben is null or reason is null
     or reason not in ('cancel','decline','timeout','hangup','lost') then
    raise exception 'NOT_ALLOWED';
  end if;

  select * into arama from public.dm_calls dc where dc.id = end_dm_call.id for update;
  if not found or (arama.caller <> ben and arama.callee <> ben) then
    raise exception 'NOT_ALLOWED';
  end if;

  -- Cevaplanmış arama zaman aşımıyla bitmez: arayan "active" olayını kaçırıp 30 sn sayacıyla
  -- bitirmeye çalışsa da konuşma sürer (satır değişmeden kalır; arayan sonra gelen "active" olayıyla
  -- konuşmaya girer). İptal ise bilinçli bir karardır: cevaplanmış aramayı da bitirir ("📞 Arama · mm:ss").
  if arama.status = 'active' and reason = 'timeout' then
    return;
  end if;

  perform public.arama_kapat(arama.id, reason);
end;
$$;

-- Aramanın canlı olduğunu bildirir (istemci 20 sn'de bir): last_seen_at = now().
-- Dönüş: true = arama sürüyor; false = bitmiş ya da bayat (istemci aramayı kapatır).
-- Bayat aramayı canlandırmaz. Taraf olmayan için de false (bilgi vermez).
create or replace function public.ping_dm_call(id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  ben uuid := auth.uid();
begin
  if ben is null then
    raise exception 'NOT_ALLOWED';
  end if;

  update public.dm_calls dc
     set last_seen_at = now()
   where dc.id = ping_dm_call.id
     and (dc.caller = ben or dc.callee = ben)
     and dc.status <> 'ended'
     and dc.last_seen_at >= now() - interval '60 seconds';
  return found;
end;
$$;

revoke all on function public.start_dm_call(uuid) from public, anon;
revoke all on function public.answer_dm_call(uuid) from public, anon;
revoke all on function public.end_dm_call(uuid, text) from public, anon;
revoke all on function public.ping_dm_call(uuid) from public, anon;
grant execute on function public.start_dm_call(uuid) to authenticated;
grant execute on function public.answer_dm_call(uuid) to authenticated;
grant execute on function public.end_dm_call(uuid, text) to authenticated;
grant execute on function public.ping_dm_call(uuid) to authenticated;

-- ========== 4) TETİKLEYİCİ ==========

-- dm_calls eklenince ya da durumu değişince iki tarafın "user:<uid>" konusuna "arama" gider.
-- Yük: call_id, thread_id, status, caller, reason (bitiş nedeni; bitmemişse null).
-- Yalnız last_seen_at değişen güncellemeler (ping) olay üretmez.
-- Yayın gönderilemezse işlem bozulmaz (007 kalıbı: hata yutulur).
create or replace function public.arama_olayi_gonder()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  kisi uuid;
begin
  if tg_op = 'UPDATE' and old.status is not distinct from new.status then
    return null;
  end if;

  foreach kisi in array array[new.caller, new.callee] loop
    begin
      perform realtime.send(
        jsonb_build_object(
          'call_id', new.id,
          'thread_id', new.thread_id,
          'status', new.status,
          'caller', new.caller,
          'reason', new.end_reason
        ),
        'arama',
        'user:' || kisi::text,
        true
      );
    exception when others then
      null; -- yayın gitmedi: işlem yine de tamamlanır
    end;
  end loop;

  return null; -- AFTER tetikleyicide dönüş değeri kullanılmaz
end;
$$;

revoke all on function public.arama_olayi_gonder() from public, anon;
grant execute on function public.arama_olayi_gonder() to authenticated;

drop trigger if exists dm_calls_degisti on public.dm_calls;
create trigger dm_calls_degisti
  after insert or update on public.dm_calls
  for each row execute function public.arama_olayi_gonder();

-- ========== 5) REALTIME YETKİLERİ ==========

-- "dm-voice:<arama uuid>": aramanın sinyal konusu (003'teki voice: kuralının DM karşılığı).
-- Yalnız aramanın iki tarafı, yalnız arama bitmemişken (bayat da bitmiş sayılır) ve engel yokken.
-- Konu arama kimliğine bağlı: biten aramanın konusu bir daha kullanılamaz.
-- Bozuk konu (uuid değilse) hata fırlatmaz, false döner.
create or replace function public.can_access_dm_voice_topic(topic text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  cid uuid;
begin
  if topic is null
     or topic !~* '^dm-voice:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;
  cid := substring(topic from 10)::uuid; -- "dm-voice:" (9 karakter) sonrası
  return exists (
    select 1 from public.dm_calls dc
    where dc.id = cid
      and (dc.caller = auth.uid() or dc.callee = auth.uid())
      and dc.status <> 'ended'
      and dc.last_seen_at >= now() - interval '60 seconds'
      and not public.engel_var(dc.caller, dc.callee)
  );
end;
$$;

revoke all on function public.can_access_dm_voice_topic(text) from public, anon;
grant execute on function public.can_access_dm_voice_topic(text) to authenticated;

-- Alma ve gönderme: yalnız yayın (broadcast) ve varlık (presence), 003'teki voice_ politikaları gibi
drop policy if exists dm_voice_receive on realtime.messages;
create policy dm_voice_receive on realtime.messages
  for select to authenticated
  using (
    realtime.messages.extension in ('broadcast', 'presence')
    and public.can_access_dm_voice_topic(realtime.topic())
  );
drop policy if exists dm_voice_send on realtime.messages;
create policy dm_voice_send on realtime.messages
  for insert to authenticated
  with check (
    realtime.messages.extension in ('broadcast', 'presence')
    and public.can_access_dm_voice_topic(realtime.topic())
  );
