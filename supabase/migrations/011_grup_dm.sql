-- 011: Grup DM ve çok kişili arama (v0.9.0).
-- Bu dosyada:
--  1) dm_threads genelleşir: is_group, name, owner_id; grup satırında user_a/user_b boş.
--     dm_members (grup üyeleri), dm_mutes (grup başına sessize alma), dm_messages.kind += 'system'
--  2) "İki kişi" varsayımı olan 007–010 fonksiyonları üyeliğe göre genelleşir:
--     is_dm_participant, can_send_dm, dm_kisileri, dm_engel_denetle (engel kodları tek yerde),
--     edit_dm_message, react_dm_message, pin_dm_message, send_dm_with_attachments,
--     tepki_olayi_gonder, sabit_olayi_gonder, kisi_olayi_gonder
--  3) Grup RPC'leri: create_group_dm, add_group_member, remove_group_member, leave_group, rename_group,
--     group_dm_list (+ sistem satırları: "berk, ayla'yı ekledi." …)
--  4) Grup araması: dm_calls.is_group (+ callee boş), dm_call_members; start_group_call, join_group_call,
--     leave_group_call, ping_group_call; bire bir arama RPC'leri grup aramasını reddeder;
--     arama_kapat grup kayıt satırını yazar; "grup_arama" olayı; dm-voice: politikası gruba genişler
--
-- Hata kodları (istemci src/data/groups.js Türkçeye çevirir): NOT_ALLOWED, CANNOT_ADD, ALREADY_MEMBER,
--   TOO_FEW, GROUP_FULL, TOO_MANY, ALREADY_IN_CALL, BUSY, CALL_FULL.
-- Engel bilgisi sızmaz: arkadaş olmayan da engelli olan da CANNOT_ADD alır ("Bu kişi eklenemedi.").
-- Bire bir DM'de engel kuralları (BLOCKED_DM / NOT_ALLOWED) AYNEN kalır; grupta engel denetimi yoktur
-- (yalnız engelli biri gruba eklenemez).
--
-- Uyumluluk (v0.8.0):
--  - Silinen ya da yeniden adlandırılan sütun yok. user_a, user_b (dm_threads) ve callee (dm_calls) yalnız
--    boş olabilir hâle gelir; eski istemci bu sütunları yalnız bire bir satırlarda görür.
--  - dm_list, unread_counts ve bire bir arama RPC'lerinin imzası/dönüşü değişmez. dm_list grupları
--    döndürmez (user_a/user_b filtresi); yeni istemci grupları group_dm_list ile alır.
--  - Grup araması olayı ayrı adla ("grup_arama") gider: eski istemci onu bire bir arama sanmaz.

-- ========== 1) ŞEMA ==========

alter table public.dm_threads add column if not exists is_group boolean not null default false;
alter table public.dm_threads add column if not exists name text
  check (name is null or length(name) between 1 and 100);
alter table public.dm_threads add column if not exists owner_id uuid references auth.users(id) on delete set null;

-- Grup satırında iki taraf yok (sütunlar silinmez, yalnız boş olabilir)
alter table public.dm_threads alter column user_a drop not null;
alter table public.dm_threads alter column user_b drop not null;
alter table public.dm_threads drop constraint if exists dm_threads_tur;
alter table public.dm_threads add constraint dm_threads_tur check (
  (is_group and user_a is null and user_b is null)
  or (not is_group and user_a is not null and user_b is not null and name is null)
);

-- Grup üyeleri. Bire bir konuşmanın satırı yoktur (taraflar dm_threads'te).
create table if not exists public.dm_members (
  thread_id uuid not null references public.dm_threads(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  added_by uuid references auth.users(id) on delete set null,
  primary key (thread_id, user_id)
);

create index if not exists dm_members_user_idx on public.dm_members (user_id);

alter table public.dm_members enable row level security;

-- Grup sessize alma (server_mutes kalıbı): yalnız kendi satırların
create table if not exists public.dm_mutes (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  thread_id uuid not null references public.dm_threads(id) on delete cascade,
  primary key (user_id, thread_id)
);

create index if not exists dm_mutes_thread_idx on public.dm_mutes (thread_id);

alter table public.dm_mutes enable row level security;

-- Sistem satırı türü: 'system' (grup: ekleme, ayrılma, çıkarma, ad). 009'daki kısıt adıyla değiştirilir.
alter table public.dm_messages drop constraint if exists dm_messages_kind_check;
alter table public.dm_messages add constraint dm_messages_kind_check check (kind in ('text','call','pin','system'));

-- ========== 2) GENELLEŞEN FONKSİYONLAR ==========

-- Çağıran bu konuşmanın tarafı mı: bire birde iki taraftan biri, grupta üye.
create or replace function public.is_dm_participant(tid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.dm_threads t
    where t.id = tid and (t.user_a = auth.uid() or t.user_b = auth.uid())
  ) or exists (
    select 1 from public.dm_members m
    where m.thread_id = tid and m.user_id = auth.uid()
  );
$$;

-- Çağıran bu konuşmaya yazabilir mi: bire birde taraf ve engel yok (007 ile AYNI); grupta üye.
create or replace function public.can_send_dm(tid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.dm_threads t
    where t.id = tid
      and not t.is_group
      and (t.user_a = auth.uid() or t.user_b = auth.uid())
      and not public.engel_var(t.user_a, t.user_b)
  ) or exists (
    select 1 from public.dm_members m
    join public.dm_threads t on t.id = m.thread_id
    where m.thread_id = tid and m.user_id = auth.uid() and t.is_group
  );
$$;

revoke all on function public.is_dm_participant(uuid) from public, anon;
revoke all on function public.can_send_dm(uuid) from public, anon;
grant execute on function public.is_dm_participant(uuid) to authenticated;
grant execute on function public.can_send_dm(uuid) to authenticated;

-- Konuşmanın kişileri: bire birde iki taraf, grupta üyeler (katılma sırasıyla).
-- Yalnız veritabanı içinde (tetikleyiciler); istemciye AÇIK DEĞİL.
create or replace function public.dm_kisileri(tid uuid)
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  select case
           when t.is_group then array(
             select m.user_id from public.dm_members m
             where m.thread_id = t.id
             order by m.joined_at, m.user_id)
           else array_remove(array[t.user_a, t.user_b], null)
         end
    from public.dm_threads t
   where t.id = tid;
$$;

-- Engel kodları TEK yerde (007–010'daki "diger" kalıbı): bire bir konuşmada engelleyen BLOCKED_DM,
-- engellenen NOT_ALLOWED (engellendiğini anlamaz). Grupta engel denetimi yok. Konuşma yoksa NOT_ALLOWED.
-- Yalnız veritabanı içinde; istemciye AÇIK DEĞİL.
create or replace function public.dm_engel_denetle(tid uuid)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  t public.dm_threads;
  diger uuid;
begin
  select * into t from public.dm_threads th where th.id = tid;
  if not found then
    raise exception 'NOT_ALLOWED';
  end if;
  if t.is_group then
    return;
  end if;
  diger := case when t.user_a = auth.uid() then t.user_b else t.user_a end;
  if exists (select 1 from public.blocks bl where bl.blocker = auth.uid() and bl.blocked = diger) then
    raise exception 'BLOCKED_DM';
  end if;
  if public.engel_var(t.user_a, t.user_b) then
    raise exception 'NOT_ALLOWED';
  end if;
end;
$$;

revoke all on function public.dm_kisileri(uuid) from public, anon, authenticated;
revoke all on function public.dm_engel_denetle(uuid) from public, anon, authenticated;

-- 009'daki edit_dm_message: tek fark, engel denetimi dm_engel_denetle ile (grupta engel yok).
create or replace function public.edit_dm_message(id bigint, yeni text)
returns public.dm_messages
language plpgsql
security definer
set search_path = public
as $$
declare
  m public.dm_messages;
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

  perform public.dm_engel_denetle(m.thread_id);
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

-- 009'daki react_dm_message: tek fark, engel denetimi dm_engel_denetle ile.
create or replace function public.react_dm_message(mid bigint, tepki text, ekle boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  ben uuid := auth.uid();
  m public.dm_messages;
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
    perform public.dm_engel_denetle(m.thread_id);
    insert into public.dm_message_reactions (message_id, user_id, emoji)
    values (m.id, ben, tepki)
    on conflict (message_id, user_id, emoji) do nothing;
  else
    delete from public.dm_message_reactions r
     where r.message_id = m.id and r.user_id = ben and r.emoji = tepki;
  end if;
end;
$$;

-- 009'daki pin_dm_message: tek fark, engel denetimi dm_engel_denetle ile. Grupta her üye sabitler.
create or replace function public.pin_dm_message(mid bigint, sabitle boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  ben uuid := auth.uid();
  m public.dm_messages;
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

  perform public.dm_engel_denetle(m.thread_id);

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

-- 010'daki send_dm_with_attachments: tek fark, engel denetimi dm_engel_denetle ile.
create or replace function public.send_dm_with_attachments(tid uuid, metin text, ekler jsonb, yanit bigint)
returns public.dm_messages
language plpgsql
security definer
set search_path = public
as $$
declare
  ben uuid := auth.uid();
  govde text := btrim(coalesce(metin, ''), E' \t\r\n');
  m public.dm_messages;
begin
  if ben is null or tid is null or not public.is_dm_participant(tid) then
    raise exception 'NOT_ALLOWED';
  end if;
  perform public.dm_engel_denetle(tid);
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

revoke all on function public.edit_dm_message(bigint, text) from public, anon;
revoke all on function public.react_dm_message(bigint, text, boolean) from public, anon;
revoke all on function public.pin_dm_message(bigint, boolean) from public, anon;
revoke all on function public.send_dm_with_attachments(uuid, text, jsonb, bigint) from public, anon;
grant execute on function public.edit_dm_message(bigint, text) to authenticated;
grant execute on function public.react_dm_message(bigint, text, boolean) to authenticated;
grant execute on function public.pin_dm_message(bigint, boolean) to authenticated;
grant execute on function public.send_dm_with_attachments(uuid, text, jsonb, bigint) to authenticated;

-- 009'daki tepki_olayi_gonder: tek fark, DM tepkisi konuşmanın bütün kişilerine (dm_kisileri).
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
    select m.thread_id into tid
      from public.dm_messages m
     where m.id = mid and m.deleted_at is null;
    if not found then
      return null;
    end if;
    foreach kisi in array coalesce(public.dm_kisileri(tid), array[]::uuid[]) loop
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

-- 009'daki sabit_olayi_gonder: tek fark, DM sabiti konuşmanın bütün kişilerine (dm_kisileri).
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
    select m.thread_id into tid
      from public.dm_messages m
     where m.id = mid and m.deleted_at is null;
    if not found then
      return null;
    end if;
    foreach kisi in array coalesce(public.dm_kisileri(tid), array[]::uuid[]) loop
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

-- 007'deki kisi_olayi_gonder: boş kişi atlanır (grup konuşmasının satırında user_a/user_b boş);
-- dm_members değişince yalnız eklenen/çıkan kişiye gider (diğer üyeler sistem satırını DM aboneliğinden alır).
create or replace function public.kisi_olayi_gonder()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  satir jsonb;
  kisiler uuid[];
  kisi uuid;
begin
  if tg_op = 'DELETE' then
    satir := to_jsonb(old);
  else
    satir := to_jsonb(new);
  end if;

  if tg_table_name = 'blocks' then
    kisiler := array[(satir ->> 'blocker')::uuid];
  elsif tg_table_name = 'dm_members' then
    kisiler := array[(satir ->> 'user_id')::uuid];
  else
    kisiler := array[(satir ->> 'user_a')::uuid, (satir ->> 'user_b')::uuid];
  end if;

  foreach kisi in array kisiler loop
    if kisi is null then
      continue;
    end if;
    begin
      perform realtime.send(
        jsonb_build_object('tablo', tg_table_name, 'islem', tg_op),
        'degisti',
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

revoke all on function public.tepki_olayi_gonder() from public, anon;
revoke all on function public.sabit_olayi_gonder() from public, anon;
revoke all on function public.kisi_olayi_gonder() from public, anon;
grant execute on function public.tepki_olayi_gonder() to authenticated;
grant execute on function public.sabit_olayi_gonder() to authenticated;
grant execute on function public.kisi_olayi_gonder() to authenticated;

drop trigger if exists dm_members_degisti on public.dm_members;
create trigger dm_members_degisti
  after insert or delete on public.dm_members
  for each row execute function public.kisi_olayi_gonder();

-- ========== 3) GRUP DM ==========

-- Üyeler birbirini görür (konuşmanın tarafı olan). Yazma politikası yok: yalnız RPC.
drop policy if exists dm_members_select on public.dm_members;
create policy dm_members_select on public.dm_members
  for select to authenticated
  using (public.is_dm_participant(thread_id));

-- Sessize alma: yalnız kendi satırların; eklerken konuşmanın tarafı olmalısın
drop policy if exists dm_mutes_select on public.dm_mutes;
create policy dm_mutes_select on public.dm_mutes
  for select to authenticated
  using (user_id = auth.uid());
drop policy if exists dm_mutes_insert on public.dm_mutes;
create policy dm_mutes_insert on public.dm_mutes
  for insert to authenticated
  with check (user_id = auth.uid() and public.is_dm_participant(thread_id));
drop policy if exists dm_mutes_delete on public.dm_mutes;
create policy dm_mutes_delete on public.dm_mutes
  for delete to authenticated
  using (user_id = auth.uid());

-- Türkçe belirtme hâli eki (ünlü uyumu): "ayla" -> "ayla'yı", "berk" -> "berk'i", "Deneme" -> "Deneme'yi".
-- Son ünlüye bakılır (a,ı -> ı; o,u -> u; e,i -> i; ö,ü -> ü); ünlüyle bitiyorsa araya "y" girer.
-- Ünlüsüz adda "'i". Yalnız sistem satırı metni için.
create or replace function public.belirtme_eki(ad text)
returns text
language plpgsql
immutable
security definer
set search_path = public
as $$
declare
  s text := lower(coalesce(ad, ''));
  unlu text := null;
  ek text;
  i int;
begin
  for i in reverse length(s)..1 loop
    if substr(s, i, 1) in ('a','ı','o','u','e','i','ö','ü') then
      unlu := substr(s, i, 1);
      exit;
    end if;
  end loop;
  ek := case unlu
          when 'a' then 'ı' when 'ı' then 'ı'
          when 'o' then 'u' when 'u' then 'u'
          when 'e' then 'i' when 'i' then 'i'
          when 'ö' then 'ü' when 'ü' then 'ü'
          else 'i'
        end;
  if right(s, 1) in ('a','ı','o','u','e','i','ö','ü') then
    return coalesce(ad, '') || '''y' || ek;
  end if;
  return coalesce(ad, '') || '''' || ek;
end;
$$;

-- Kişinin adı (profil yoksa "Biri")
create or replace function public.kisi_adi(uid uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select p.username from public.profiles p where p.id = uid), 'Biri');
$$;

-- Kişi kaç gruba üye
create or replace function public.grup_sayisi(uid uuid)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::int from public.dm_members m where m.user_id = uid;
$$;

-- Bu kişi gruba eklenebilir mi (ben ekliyorum): profili var, arkadaşım, iki yönde engel yok, 100 grup sınırı.
create or replace function public.gruba_eklenebilir(ben uuid, uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select uid is not null
     and uid <> ben
     and exists (select 1 from public.profiles p where p.id = uid)
     and exists (select 1 from public.friendships fr
                 where fr.user_a = least(ben, uid) and fr.user_b = greatest(ben, uid)
                   and fr.status = 'accepted')
     and not public.engel_var(ben, uid)
     and public.grup_sayisi(uid) < 100;
$$;

-- Gruba sistem satırı yazar (kind 'system'; düzenlenemez, silinemez). Yazarı işlemi yapan.
create or replace function public.grup_sistem_satiri(tid uuid, yazar uuid, metin text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.dm_messages (thread_id, author_id, content, kind)
  values (tid, yazar, left(metin, 2000), 'system');
end;
$$;

-- Çağıranın üyesi olduğu grup (yoksa NOT_ALLOWED). Dönüş: konuşma satırı.
create or replace function public.benim_grubum(tid uuid)
returns public.dm_threads
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  t public.dm_threads;
begin
  select * into t from public.dm_threads th where th.id = tid;
  if not found or not t.is_group
     or not exists (select 1 from public.dm_members m where m.thread_id = tid and m.user_id = auth.uid()) then
    raise exception 'NOT_ALLOWED';
  end if;
  return t;
end;
$$;

-- Ad denetimi: boş -> null; 100 karakterden uzun ya da kontrol karakterli -> NOT_ALLOWED
create or replace function public.grup_adi(ad text)
returns text
language plpgsql
immutable
security definer
set search_path = public
as $$
declare
  a text := nullif(btrim(coalesce(ad, ''), E' \t\r\n'), '');
begin
  if a is not null and (length(a) > 100 or a ~ '[\x01-\x1f\x7f]') then
    raise exception 'NOT_ALLOWED';
  end if;
  return a;
end;
$$;

revoke all on function public.belirtme_eki(text) from public, anon, authenticated;
revoke all on function public.kisi_adi(uuid) from public, anon, authenticated;
revoke all on function public.grup_sayisi(uuid) from public, anon, authenticated;
revoke all on function public.gruba_eklenebilir(uuid, uuid) from public, anon, authenticated;
revoke all on function public.grup_sistem_satiri(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.benim_grubum(uuid) from public, anon, authenticated;
revoke all on function public.grup_adi(text) from public, anon, authenticated;

-- Grup kurar. uyeler: diğer üyeler (ben dahil değilse eklenir; tekrarlar atılır). ad: isteğe bağlı.
-- Kendin dahil 3–10 kişi: TOO_FEW / GROUP_FULL. Her üye arkadaşın ve engelsiz olmalı: CANNOT_ADD.
-- Kişi en çok 100 gruba üye olabilir: TOO_MANY. Dönüş: konuşma id'si.
-- Katılma sırası: önce kurucu, sonra diğerleri (mikro saniye arayla; "en eski üye" belirli olsun).
create or replace function public.create_group_dm(uyeler uuid[], ad text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  ben uuid := auth.uid();
  adi text := public.grup_adi(ad);
  liste uuid[];
  u uuid;
  tid uuid;
begin
  if ben is null then
    raise exception 'NOT_ALLOWED';
  end if;

  select coalesce(array_agg(distinct x order by x), array[]::uuid[]) into liste
    from unnest(coalesce(uyeler, array[]::uuid[])) as x
   where x is not null and x <> ben;

  if cardinality(liste) + 1 < 3 then
    raise exception 'TOO_FEW';
  end if;
  if cardinality(liste) + 1 > 10 then
    raise exception 'GROUP_FULL';
  end if;
  if public.grup_sayisi(ben) >= 100 then
    raise exception 'TOO_MANY';
  end if;
  foreach u in array liste loop
    if not public.gruba_eklenebilir(ben, u) then
      raise exception 'CANNOT_ADD';
    end if;
  end loop;

  insert into public.dm_threads (is_group, name, owner_id)
  values (true, adi, ben)
  returning id into tid;

  insert into public.dm_members (thread_id, user_id, joined_at, added_by)
  select tid, k.uid, now() + (k.sira::double precision * interval '1 microsecond'), ben
    from unnest(array[ben] || liste) with ordinality as k(uid, sira);

  perform public.grup_sistem_satiri(tid, ben, public.kisi_adi(ben) || ' grubu oluşturdu.');
  return tid;
end;
$$;

-- Gruba üye ekler (her üye, kendi arkadaşını). CANNOT_ADD (arkadaş değil / engel / sınır),
-- ALREADY_MEMBER, GROUP_FULL (10). Yeni üye geçmişi görür; okunmamış sayacı eklendiği andan başlar.
-- Grup başı kilit: aynı anda iki ekleme 10'u geçemez.
create or replace function public.add_group_member(tid uuid, uid uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  ben uuid := auth.uid();
  son bigint;
begin
  if ben is null then
    raise exception 'NOT_ALLOWED';
  end if;
  perform public.benim_grubum(tid);

  perform pg_advisory_xact_lock(hashtextextended('dmgroup:' || tid::text, 0));
  -- Kilitten sonra yeniden: bu arada çıkarılmış olabilirim (çıkarılan biri üye ekleyemesin)
  perform public.benim_grubum(tid);

  if exists (select 1 from public.dm_members m where m.thread_id = tid and m.user_id = uid) then
    raise exception 'ALREADY_MEMBER';
  end if;
  if not public.gruba_eklenebilir(ben, uid) then
    raise exception 'CANNOT_ADD';
  end if;
  if (select count(*) from public.dm_members m where m.thread_id = tid) >= 10 then
    raise exception 'GROUP_FULL';
  end if;

  select coalesce(max(dm.id), 0) into son from public.dm_messages dm where dm.thread_id = tid;

  insert into public.dm_members (thread_id, user_id, added_by)
  values (tid, uid, ben);

  -- Okunmamış sayacı eklendiği andan başlar; eski üyelikten kalan gizleme kaydı silinir
  insert into public.dm_reads as r (user_id, thread_id, last_read_id)
  values (uid, tid, son)
  on conflict (user_id, thread_id) do update set last_read_id = greatest(r.last_read_id, excluded.last_read_id);
  delete from public.dm_hidden h where h.user_id = uid and h.thread_id = tid;

  perform public.grup_sistem_satiri(tid, ben,
    public.kisi_adi(ben) || ', ' || public.belirtme_eki(public.kisi_adi(uid)) || ' ekledi.');
end;
$$;

-- Kişiyi gruptan düşürür (ayrılma ve çıkarma ortak; 'dmgroup:' kilidi çağırandadır): açık grup aramasından
-- HEMEN çıkar (katılım satırı biter; "grup_arama" olayı katılımcı listesiyle gider, kalan istemciler bu kişinin
-- bağlantısını kapatır, kişinin ping'i false döner, yeniden katılamaz), üyeliği ve kişisel kayıtları (okundu,
-- gizleme, sessiz) silinir. Yalnız veritabanı içinde.
-- Kilit sırası (katılma/ayrılma ile kilitlenme olmasın): 'dmgroup:' -> 'grpcall:' -> dm_calls satırı ->
-- dm_call_members satırları. Hiçbir yol önce 'grpcall:' sonra 'dmgroup:' almaz.
create or replace function public.gruptan_dusur(tid uuid, uid uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  c uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended('grpcall:' || tid::text, 0));
  for c in select dc.id from public.dm_calls dc
            where dc.thread_id = tid and dc.status <> 'ended'
            order by dc.id
            for update loop
    update public.dm_call_members cm set left_at = now()
     where cm.call_id = c and cm.user_id = uid and cm.left_at is null;
  end loop;
  delete from public.dm_members m where m.thread_id = tid and m.user_id = uid;
  delete from public.dm_reads r where r.thread_id = tid and r.user_id = uid;
  delete from public.dm_hidden h where h.thread_id = tid and h.user_id = uid;
  delete from public.dm_mutes mu where mu.thread_id = tid and mu.user_id = uid;
  -- Arama: kalan katılımcı yoksa biter
  for c in select dc.id from public.dm_calls dc where dc.thread_id = tid and dc.status <> 'ended' loop
    perform public.grup_aramasi_temizle(c);
  end loop;
end;
$$;

-- Gruptan ayrılır. Kurucu ayrılırsa kuruculuk en eski üyeye geçer. Son üye ayrılınca grup silinir
-- (mesajlar, tepkiler, sabitler, ek satırları cascade ile; depodaki dosyaları yükleyenin yetim temizliği siler).
create or replace function public.leave_group(tid uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  ben uuid := auth.uid();
  t public.dm_threads;
  yeni uuid;
begin
  if ben is null then
    raise exception 'NOT_ALLOWED';
  end if;
  perform public.benim_grubum(tid);

  perform pg_advisory_xact_lock(hashtextextended('dmgroup:' || tid::text, 0));
  t := public.benim_grubum(tid); -- kilitten sonra yeniden (bu arada çıkarılmış olabilirim)
  perform public.gruptan_dusur(tid, ben);

  select m.user_id into yeni from public.dm_members m
   where m.thread_id = tid
   order by m.joined_at, m.user_id
   limit 1;
  if yeni is null then
    delete from public.dm_threads th where th.id = tid;
    return;
  end if;
  if t.owner_id is null or t.owner_id = ben
     or not exists (select 1 from public.dm_members m where m.thread_id = tid and m.user_id = t.owner_id) then
    update public.dm_threads th set owner_id = yeni where th.id = tid;
  end if;

  perform public.grup_sistem_satiri(tid, ben, public.kisi_adi(ben) || ' gruptan ayrıldı.');
end;
$$;

-- Kurucu bir üyeyi çıkarır. Kendini çıkaramaz (ayrılma ayrı). Üye değilse NOT_ALLOWED.
create or replace function public.remove_group_member(tid uuid, uid uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  ben uuid := auth.uid();
  t public.dm_threads;
begin
  if ben is null then
    raise exception 'NOT_ALLOWED';
  end if;
  t := public.benim_grubum(tid);
  if t.owner_id is distinct from ben or uid is null or uid = ben then
    raise exception 'NOT_ALLOWED';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('dmgroup:' || tid::text, 0));
  -- Kilitten sonra yeniden: hâlâ üye ve kurucu muyum (bu arada ayrılmış/devretmiş olabilirim)
  t := public.benim_grubum(tid);
  if t.owner_id is distinct from ben then
    raise exception 'NOT_ALLOWED';
  end if;
  if not exists (select 1 from public.dm_members m where m.thread_id = tid and m.user_id = uid) then
    raise exception 'NOT_ALLOWED';
  end if;

  perform public.gruptan_dusur(tid, uid);
  perform public.grup_sistem_satiri(tid, ben,
    public.kisi_adi(ben) || ', ' || public.belirtme_eki(public.kisi_adi(uid)) || ' çıkardı.');
end;
$$;

-- Grubun adını değiştirir (her üye). Boş ad, adı kaldırır (liste üyelerin adlarını gösterir).
-- Aynı adsa bir şey olmaz (sistem satırı da yazılmaz).
create or replace function public.rename_group(tid uuid, ad text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  ben uuid := auth.uid();
  t public.dm_threads;
  adi text := public.grup_adi(ad);
begin
  if ben is null then
    raise exception 'NOT_ALLOWED';
  end if;
  t := public.benim_grubum(tid);
  if t.name is not distinct from adi then
    return;
  end if;

  update public.dm_threads th set name = adi where th.id = tid;
  if adi is null then
    perform public.grup_sistem_satiri(tid, ben, public.kisi_adi(ben) || ' grubun adını kaldırdı.');
  else
    perform public.grup_sistem_satiri(tid, ben, public.kisi_adi(ben) || ' grubun adını “' || adi || '” yaptı.');
  end if;
end;
$$;

-- ========== 4) GRUP ARAMASI ==========

alter table public.dm_calls add column if not exists is_group boolean not null default false;
-- Grup aramasında aranan tek kişi yok (sütun silinmez, yalnız boş olabilir)
alter table public.dm_calls alter column callee drop not null;
alter table public.dm_calls drop constraint if exists dm_calls_tur;
alter table public.dm_calls add constraint dm_calls_tur check (
  (is_group and callee is null) or (not is_group and callee is not null)
);

-- Grup aramasının katılımcıları. left_at boş = aramada. Yeniden katılınca left_at boşalır.
create table if not exists public.dm_call_members (
  call_id uuid not null references public.dm_calls(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  left_at timestamptz,
  primary key (call_id, user_id)
);

-- Meşgul denetimi: kişinin ayrılmadığı grup aramaları
create index if not exists dm_call_members_user_acik on public.dm_call_members (user_id) where left_at is null;

alter table public.dm_call_members enable row level security;

-- Okuma: aramanın konuşmasının üyeleri. Yazma politikası yok: yalnız RPC.
drop policy if exists dm_call_members_select on public.dm_call_members;
create policy dm_call_members_select on public.dm_call_members
  for select to authenticated
  using (
    exists (select 1 from public.dm_calls c
            where c.id = call_id and public.is_dm_participant(c.thread_id))
  );

-- 008'deki dm_calls_select: grup aramasını konuşmanın üyeleri de okur
drop policy if exists dm_calls_select on public.dm_calls;
create policy dm_calls_select on public.dm_calls
  for select to authenticated
  using (
    caller = auth.uid() or callee = auth.uid()
    or (is_group and public.is_dm_participant(thread_id))
  );

-- Kişi bayat olmayan bir bire bir aramada mı (çalan ya da süren)?
create or replace function public.kisi_ikili_aramada(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.dm_calls dc
    where not dc.is_group
      and dc.status <> 'ended'
      and (dc.caller = uid or dc.callee = uid)
      and dc.last_seen_at >= now() - interval '60 seconds'
      and not (dc.status = 'ringing' and dc.created_at < now() - interval '40 seconds')
  );
$$;

-- Kişi bayat olmayan bir grup aramasında mı (haric dışında)? Katılımcının ping'i 60 sn'den eskiyse çıkmış sayılır.
create or replace function public.kisi_grup_aramasinda(uid uuid, haric uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.dm_call_members cm
    join public.dm_calls dc on dc.id = cm.call_id
    where cm.user_id = uid
      and cm.left_at is null
      and cm.last_seen_at >= now() - interval '60 seconds'
      and dc.status <> 'ended'
      and dc.last_seen_at >= now() - interval '60 seconds'
      and dc.id is distinct from haric
  );
$$;

-- Grup aramasının "grup_arama" olayını konuşmanın bütün üyelerine gönderir.
-- Yük: call_id, thread_id, status, caller, reason (bitiş nedeni), count (aramadaki kişi sayısı),
-- participants (aramadaki kişilerin id'leri; istemci bağlantılarını buna göre uzlaştırır).
create or replace function public.grup_arama_olayi(cid uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  arama public.dm_calls;
  sayi int;
  kisiler jsonb;
  kisi uuid;
begin
  select * into arama from public.dm_calls dc where dc.id = cid;
  if not found then
    return;
  end if;
  select count(*)::int, coalesce(jsonb_agg(cm.user_id order by cm.joined_at, cm.user_id), '[]'::jsonb)
    into sayi, kisiler
    from public.dm_call_members cm
   where cm.call_id = cid and cm.left_at is null;
  if arama.status = 'ended' then
    sayi := 0;
    kisiler := '[]'::jsonb;
  end if;
  foreach kisi in array coalesce(public.dm_kisileri(arama.thread_id), array[]::uuid[]) loop
    begin
      perform realtime.send(
        jsonb_build_object(
          'call_id', arama.id,
          'thread_id', arama.thread_id,
          'status', arama.status,
          'caller', arama.caller,
          'reason', arama.end_reason,
          'count', sayi,
          'participants', kisiler
        ),
        'grup_arama',
        'user:' || kisi::text,
        true
      );
    exception when others then
      null; -- yayın gitmedi: işlem yine de tamamlanır
    end;
  end loop;
end;
$$;

-- 008'deki arama_kapat: bire bir dal AYNI; grup aramasında bütün katılımcılar çıkmış sayılır ve
-- tek kayıt satırı yazılır: "📞 Grup araması · 12:34 · 4 kişi" (süre ilk katılımdan bitişe; kişi = katılan
-- farklı kişi sayısı) ya da kimse katılmadıysa "📞 Cevapsız grup araması". Yazarı başlatan.
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
  sure_yazi text;
  kisi int;
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

  if arama.answered_at is not null then
    sure := greatest(0, floor(extract(epoch from (bitis - arama.answered_at)))::int);
    if sure >= 3600 then
      -- s:dd:ss
      sure_yazi := (sure / 3600)::text || ':'
                   || lpad(((sure % 3600) / 60)::text, 2, '0') || ':' || lpad((sure % 60)::text, 2, '0');
    else
      -- mm:ss
      sure_yazi := lpad((sure / 60)::text, 2, '0') || ':' || lpad((sure % 60)::text, 2, '0');
    end if;
  end if;

  if arama.is_group then
    update public.dm_call_members cm set left_at = bitis
     where cm.call_id = cid and cm.left_at is null;
    select count(*)::int into kisi from public.dm_call_members cm where cm.call_id = cid;
    if arama.answered_at is null then
      metin := '📞 Cevapsız grup araması';
    else
      metin := '📞 Grup araması · ' || sure_yazi || ' · ' || kisi::text || ' kişi';
    end if;
  elsif arama.answered_at is null then
    metin := '📞 Cevapsız arama';
  else
    metin := '📞 Arama · ' || sure_yazi;
  end if;

  insert into public.dm_messages (thread_id, author_id, content, kind)
  values (arama.thread_id, arama.caller, metin, 'call');
end;
$$;

-- Grup aramasının bayatlarını temizler (kilit çağırandadır): ping'i 60 sn gelmeyen katılımcı çıkmış sayılır;
-- arama bayatsa (60 sn ping yok ya da 40 sn'den uzun süredir çalıyor) 'lost' ile, kimse kalmadıysa
-- 'hangup' ile biter. Yalnız veritabanı içinde.
create or replace function public.grup_aramasi_temizle(cid uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  arama public.dm_calls;
begin
  select * into arama from public.dm_calls dc where dc.id = cid for update;
  if not found or arama.status = 'ended' or not arama.is_group then
    return;
  end if;
  update public.dm_call_members cm set left_at = cm.last_seen_at
   where cm.call_id = cid and cm.left_at is null
     and cm.last_seen_at < now() - interval '60 seconds';
  if arama.last_seen_at < now() - interval '60 seconds'
     or (arama.status = 'ringing' and arama.created_at < now() - interval '40 seconds') then
    perform public.arama_kapat(cid, 'lost');
    return;
  end if;
  if not exists (select 1 from public.dm_call_members cm where cm.call_id = cid and cm.left_at is null) then
    perform public.arama_kapat(cid, 'hangup');
  end if;
end;
$$;

-- Aramaya katılır (kilitler ve bayat temizliği çağırandadır). Başka bir aramadaysan ALREADY_IN_CALL
-- (istemci önce eski aramadan çıkar). 10 kişi doluysa CALL_FULL. Başlatandan başka biri katılınca
-- arama 'active' olur. Dönüş: aramanın satırı.
create or replace function public.grup_aramasina_katil(cid uuid, ben uuid)
returns public.dm_calls
language plpgsql
security definer
set search_path = public
as $$
declare
  arama public.dm_calls;
begin
  if public.kisi_ikili_aramada(ben) or public.kisi_grup_aramasinda(ben, cid) then
    raise exception 'ALREADY_IN_CALL';
  end if;
  if (select count(*) from public.dm_call_members cm
      where cm.call_id = cid and cm.left_at is null and cm.user_id <> ben) >= 10 then
    raise exception 'CALL_FULL';
  end if;

  insert into public.dm_call_members as cm (call_id, user_id)
  values (cid, ben)
  on conflict (call_id, user_id) do update set left_at = null, last_seen_at = now();

  update public.dm_calls dc
     set last_seen_at = now(),
         status = case when dc.status = 'ringing' and dc.caller <> ben then 'active' else dc.status end,
         answered_at = case when dc.status = 'ringing' and dc.caller <> ben then now() else dc.answered_at end
   where dc.id = cid
  returning * into arama;
  return arama;
end;
$$;

revoke all on function public.kisi_ikili_aramada(uuid) from public, anon, authenticated;
revoke all on function public.kisi_grup_aramasinda(uuid, uuid) from public, anon, authenticated;
revoke all on function public.grup_arama_olayi(uuid) from public, anon, authenticated;
revoke all on function public.arama_kapat(uuid, text) from public, anon, authenticated;
revoke all on function public.grup_aramasi_temizle(uuid) from public, anon, authenticated;
revoke all on function public.grup_aramasina_katil(uuid, uuid) from public, anon, authenticated;
revoke all on function public.gruptan_dusur(uuid, uuid) from public, anon, authenticated;

-- Grup araması başlatır: açık (bayat olmayan) arama varsa ona katılır, yoksa açar (başlatan hemen içeride).
-- Yalnız grubun üyesi. Kilitler: grup başı 'grpcall:' sonra kişi başı 'dmcall:' (bire bir aramayla ortak).
create or replace function public.start_group_call(tid uuid)
returns public.dm_calls
language plpgsql
security definer
set search_path = public
as $$
declare
  ben uuid := auth.uid();
  arama public.dm_calls;
  eski uuid;
begin
  if ben is null then
    raise exception 'NOT_ALLOWED';
  end if;
  perform public.benim_grubum(tid);

  perform pg_advisory_xact_lock(hashtextextended('grpcall:' || tid::text, 0));
  perform pg_advisory_xact_lock(hashtextextended('dmcall:' || ben::text, 0));

  for eski in select dc.id from public.dm_calls dc
               where dc.thread_id = tid and dc.status <> 'ended' order by dc.id loop
    perform public.grup_aramasi_temizle(eski);
  end loop;

  select * into arama from public.dm_calls dc
   where dc.thread_id = tid and dc.status <> 'ended'
   for update;
  if found then
    return public.grup_aramasina_katil(arama.id, ben);
  end if;

  if public.kisi_ikili_aramada(ben) or public.kisi_grup_aramasinda(ben, null) then
    raise exception 'ALREADY_IN_CALL';
  end if;

  insert into public.dm_calls (thread_id, caller, callee, is_group)
  values (tid, ben, null, true)
  returning * into arama;
  insert into public.dm_call_members (call_id, user_id) values (arama.id, ben);
  return arama;
end;
$$;

-- Süren grup aramasına katılır. Bitmiş ya da bayatsa satırı 'ended' döner (istemci "Arama sona erdi." der).
create or replace function public.join_group_call(cid uuid)
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
  select * into arama from public.dm_calls dc where dc.id = cid;
  if not found or not arama.is_group then
    raise exception 'NOT_ALLOWED';
  end if;
  perform public.benim_grubum(arama.thread_id);

  perform pg_advisory_xact_lock(hashtextextended('grpcall:' || arama.thread_id::text, 0));
  perform pg_advisory_xact_lock(hashtextextended('dmcall:' || ben::text, 0));
  perform public.grup_aramasi_temizle(cid);

  select * into arama from public.dm_calls dc where dc.id = cid for update;
  if arama.status = 'ended' then
    return arama;
  end if;
  return public.grup_aramasina_katil(cid, ben);
end;
$$;

-- Grup aramasından ayrılır. reason: 'hangup' | 'cancel' | 'timeout' | 'lost'.
--  - 'cancel' / 'timeout': başlatan, arama hâlâ çalarken (kimse katılmadı) aramayı bitirir ("Cevap yok").
--    Cevaplanmış arama zaman aşımıyla bitmez (008 gibi): o zaman 'cancel' ve 'timeout' yalnız çağıranın
--    ayrılması sayılır (istemci sayacı dolunca yerelde çıktı; satırı açık kalıp "hayalet" olmasın).
--  - Diğerleri: yalnız çağıran çıkar; son katılımcı çıkınca arama biter.
-- Aramaya hiç katılmamış kişi için NOT_ALLOWED. Zaten bitmişse sessizce geçer.
create or replace function public.leave_group_call(cid uuid, reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  ben uuid := auth.uid();
  arama public.dm_calls;
begin
  if ben is null or reason is null or reason not in ('hangup','cancel','timeout','lost') then
    raise exception 'NOT_ALLOWED';
  end if;
  select * into arama from public.dm_calls dc where dc.id = cid;
  if not found or not arama.is_group
     or not exists (select 1 from public.dm_call_members cm where cm.call_id = cid and cm.user_id = ben) then
    raise exception 'NOT_ALLOWED';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('grpcall:' || arama.thread_id::text, 0));
  select * into arama from public.dm_calls dc where dc.id = cid for update;
  if arama.status = 'ended' then
    return;
  end if;

  if reason in ('cancel','timeout') and arama.status = 'ringing' and arama.caller = ben then
    perform public.arama_kapat(cid, reason);
    return;
  end if;

  update public.dm_call_members cm set left_at = now()
   where cm.call_id = cid and cm.user_id = ben and cm.left_at is null;
  perform public.grup_aramasi_temizle(cid);
end;
$$;

-- Canlılık (istemci 20 sn'de bir): katılımcının ve aramanın last_seen_at'i. Dönüş: true = sürüyor;
-- false = arama bitti/bayat ya da ben çıkmış sayıldım / gruptan çıkarıldım (istemci aramadan çıkar).
-- Bayatı canlandırmaz. Ayrıca 60 sn'dir ping'i gelmeyen diğer katılımcılar burada çıkmış sayılır
-- (grup_aramasi_temizle): "grup_arama" olayı gider, kalanların sayısı ve bağlantıları güncellenir.
-- Kilit: 'grpcall:' (katılma/ayrılma/çıkarma ile aynı sıra).
create or replace function public.ping_group_call(cid uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  ben uuid := auth.uid();
  tid uuid;
begin
  if ben is null then
    raise exception 'NOT_ALLOWED';
  end if;
  select dc.thread_id into tid from public.dm_calls dc
   where dc.id = ping_group_call.cid and dc.is_group and dc.status <> 'ended';
  if tid is null
     or not exists (select 1 from public.dm_call_members cm
                    where cm.call_id = ping_group_call.cid and cm.user_id = ben and cm.left_at is null) then
    return false;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('grpcall:' || tid::text, 0));

  update public.dm_call_members cm
     set last_seen_at = now()
    from public.dm_calls dc
   where cm.call_id = ping_group_call.cid
     and cm.user_id = ben
     and cm.left_at is null
     and cm.last_seen_at >= now() - interval '60 seconds'
     and dc.id = cm.call_id
     and dc.is_group
     and dc.status <> 'ended'
     and dc.last_seen_at >= now() - interval '60 seconds';
  if not found then
    return false;
  end if;
  update public.dm_calls dc set last_seen_at = now() where dc.id = ping_group_call.cid;
  perform public.grup_aramasi_temizle(ping_group_call.cid); -- bayat diğerleri çıkar (olay gider)
  return true;
end;
$$;

-- ---- 008'deki bire bir arama RPC'leri: grup aramasını/konuşmasını reddeder ----
-- (callee boş olunca "callee <> ben" null döner ve eski denetim açık kapı bırakırdı.)

-- 008'deki start_dm_call: farklar (1) grup konuşması NOT_ALLOWED, (2) bayat temizliği ve meşgul
-- denetimi yalnız bire bir aramalara bakar, (3) karşı taraf bir grup aramasındaysa da BUSY.
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
  if not found or konusma.is_group
     or konusma.user_a is null or konusma.user_b is null
     or (konusma.user_a <> ben and konusma.user_b <> ben) then
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

  -- İki tarafın bayat bire bir aramalarını bitir (id sırasıyla)
  for eski in
    select dc.id from public.dm_calls dc
     where not dc.is_group
       and dc.status <> 'ended'
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
    if arama.status = 'active' then
      raise exception 'ALREADY_IN_CALL';
    end if;
    if arama.status = 'ringing' and arama.caller = diger then
      update public.dm_calls dc
         set status = 'active', answered_at = now(), last_seen_at = now()
       where dc.id = arama.id
      returning * into arama;
    end if;
    return arama;
  end if;

  -- Meşgul: karşı tarafın başka bir bire bir araması ya da bayat olmayan bir grup araması
  if exists (select 1 from public.dm_calls dc
             where not dc.is_group and dc.status <> 'ended' and (dc.caller = diger or dc.callee = diger))
     or public.kisi_grup_aramasinda(diger, null) then
    raise exception 'BUSY';
  end if;

  insert into public.dm_calls (thread_id, caller, callee)
  values (konusma.id, ben, diger)
  returning * into arama;
  return arama;
end;
$$;

-- 008'deki answer_dm_call: tek fark, grup araması NOT_ALLOWED.
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
  if not found or arama.is_group or arama.callee is null or arama.callee <> ben then
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

-- 008'deki end_dm_call: tek fark, grup araması NOT_ALLOWED (gruptan ayrılmak leave_group_call ile).
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
  if not found or arama.is_group or arama.callee is null
     or (arama.caller <> ben and arama.callee <> ben) then
    raise exception 'NOT_ALLOWED';
  end if;

  if arama.status = 'active' and reason = 'timeout' then
    return;
  end if;

  perform public.arama_kapat(arama.id, reason);
end;
$$;

-- 008'deki ping_dm_call: tek fark, grup araması false (grupta ping_group_call).
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
     and not dc.is_group
     and (dc.caller = ben or dc.callee = ben)
     and dc.status <> 'ended'
     and dc.last_seen_at >= now() - interval '60 seconds';
  return found;
end;
$$;

revoke all on function public.start_group_call(uuid) from public, anon;
revoke all on function public.join_group_call(uuid) from public, anon;
revoke all on function public.leave_group_call(uuid, text) from public, anon;
revoke all on function public.ping_group_call(uuid) from public, anon;
revoke all on function public.start_dm_call(uuid) from public, anon;
revoke all on function public.answer_dm_call(uuid) from public, anon;
revoke all on function public.end_dm_call(uuid, text) from public, anon;
revoke all on function public.ping_dm_call(uuid) from public, anon;
grant execute on function public.start_group_call(uuid) to authenticated;
grant execute on function public.join_group_call(uuid) to authenticated;
grant execute on function public.leave_group_call(uuid, text) to authenticated;
grant execute on function public.ping_group_call(uuid) to authenticated;
grant execute on function public.start_dm_call(uuid) to authenticated;
grant execute on function public.answer_dm_call(uuid) to authenticated;
grant execute on function public.end_dm_call(uuid, text) to authenticated;
grant execute on function public.ping_dm_call(uuid) to authenticated;

-- ---- Olaylar ----

-- 008'deki arama_olayi_gonder: bire bir dal AYNI ("arama", iki taraf). Grup aramasının durumu değişince
-- "grup_arama" (bütün üyeler). Grup aramasının EKLENMESİ olay üretmez: hemen ardından gelen başlatanın
-- katılım satırı (dm_call_members) olayı gönderir (tek olay; sayı 1).
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

  if new.is_group then
    if tg_op = 'UPDATE' then
      perform public.grup_arama_olayi(new.id);
    end if;
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

-- Katılımcı girince/çıkınca (left_at değişince) "grup_arama" (sayı değişti). Ping (yalnız last_seen_at)
-- olay üretmez. Arama bittiyse gönderilmez (bitiş olayını dm_calls tetikleyicisi zaten gönderdi).
create or replace function public.arama_uyesi_olayi_gonder()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and old.left_at is not distinct from new.left_at then
    return null;
  end if;
  if exists (select 1 from public.dm_calls dc where dc.id = new.call_id and dc.status = 'ended') then
    return null;
  end if;
  perform public.grup_arama_olayi(new.call_id);
  return null;
end;
$$;

revoke all on function public.arama_olayi_gonder() from public, anon;
revoke all on function public.arama_uyesi_olayi_gonder() from public, anon;
grant execute on function public.arama_olayi_gonder() to authenticated;
grant execute on function public.arama_uyesi_olayi_gonder() to authenticated;

drop trigger if exists dm_call_members_degisti on public.dm_call_members;
create trigger dm_call_members_degisti
  after insert or update on public.dm_call_members
  for each row execute function public.arama_uyesi_olayi_gonder();

-- ---- Realtime ----

-- 008'deki can_access_dm_voice_topic: bire bir dal AYNI (yalnız bire bir aramada); grup aramasında
-- konuşmanın üyesi + aramada (ayrılmamış) + arama bitmemiş ve bayat değil.
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
      and not dc.is_group
      and (dc.caller = auth.uid() or dc.callee = auth.uid())
      and dc.status <> 'ended'
      and dc.last_seen_at >= now() - interval '60 seconds'
      and not public.engel_var(dc.caller, dc.callee)
  ) or exists (
    select 1 from public.dm_calls dc
    join public.dm_call_members cm on cm.call_id = dc.id and cm.user_id = auth.uid()
    where dc.id = cid
      and dc.is_group
      and dc.status <> 'ended'
      and dc.last_seen_at >= now() - interval '60 seconds'
      and cm.left_at is null
      and public.is_dm_participant(dc.thread_id)
  );
end;
$$;

revoke all on function public.can_access_dm_voice_topic(text) from public, anon;
grant execute on function public.can_access_dm_voice_topic(text) to authenticated;

-- ========== 5) GRUP LİSTESİ ==========

-- Yeni istemcinin grup listesi (dm_list grupları döndürmez; v0.8.0 için dönüşü değişmedi).
-- Satır: konuşma, ad (boş olabilir), kurucu, üyeler (katılma sırasıyla, profil alanlarıyla), açılış ve son
-- mesaj zamanı, okunmamış (dm_list ile aynı kural, en çok 100), sessizde mi, süren (bayat olmayan)
-- grup aramasının id'si ve aramadaki kişi sayısı. Gizlenen grup (yeni mesaj yoksa) listede yok.
create or replace function public.group_dm_list()
returns table (
  thread_id uuid,
  name text,
  owner_id uuid,
  members jsonb,
  created_at timestamptz,
  last_message_at timestamptz,
  unread int,
  muted boolean,
  call_id uuid,
  call_count int
)
language sql
stable
security definer
set search_path = public
as $$
  select t.id, t.name, t.owner_id,
         (select coalesce(jsonb_agg(jsonb_build_object(
                    'id', m.user_id, 'username', p.username, 'color', p.color, 'avatar_url', p.avatar_url)
                  order by m.joined_at, m.user_id), '[]'::jsonb)
            from public.dm_members m
            left join public.profiles p on p.id = m.user_id
           where m.thread_id = t.id),
         t.created_at, t.last_message_at,
         (select count(*)::int from (
            select 1 from public.dm_messages dm
            where dm.thread_id = t.id
              and dm.id > coalesce(r.last_read_id, 0)
              and dm.deleted_at is null
              and dm.author_id <> auth.uid()
            limit 100
          ) x),
         exists (select 1 from public.dm_mutes mu where mu.thread_id = t.id and mu.user_id = auth.uid()),
         c.id,
         c.sayi
    from public.dm_members ben
    join public.dm_threads t on t.id = ben.thread_id and t.is_group
    left join public.dm_reads r on r.thread_id = t.id and r.user_id = auth.uid()
    left join public.dm_hidden h on h.thread_id = t.id and h.user_id = auth.uid()
    left join lateral (
      select dc.id,
             (select count(*)::int from public.dm_call_members cm
               where cm.call_id = dc.id and cm.left_at is null
                 and cm.last_seen_at >= now() - interval '60 seconds') as sayi
        from public.dm_calls dc
       where dc.thread_id = t.id
         and dc.status <> 'ended'
         and dc.last_seen_at >= now() - interval '60 seconds'
         and not (dc.status = 'ringing' and dc.created_at < now() - interval '40 seconds')
       limit 1
    ) c on true
   where ben.user_id = auth.uid()
     and (h.thread_id is null
          or exists (select 1 from public.dm_messages m2
                     where m2.thread_id = t.id and m2.id > h.hidden_after_id))
   order by coalesce(t.last_message_at, t.created_at) desc;
$$;

revoke all on function public.create_group_dm(uuid[], text) from public, anon;
revoke all on function public.add_group_member(uuid, uuid) from public, anon;
revoke all on function public.remove_group_member(uuid, uuid) from public, anon;
revoke all on function public.leave_group(uuid) from public, anon;
revoke all on function public.rename_group(uuid, text) from public, anon;
revoke all on function public.group_dm_list() from public, anon;
grant execute on function public.create_group_dm(uuid[], text) to authenticated;
grant execute on function public.add_group_member(uuid, uuid) to authenticated;
grant execute on function public.remove_group_member(uuid, uuid) to authenticated;
grant execute on function public.leave_group(uuid) to authenticated;
grant execute on function public.rename_group(uuid, text) to authenticated;
grant execute on function public.group_dm_list() to authenticated;
