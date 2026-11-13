-- 007: Sosyal (v0.4.0).
-- Bu dosyada:
--  1) Arkadaşlık (friendships) ve engelleme (blocks) + RPC'leri
--  2) Özel mesaj (DM): dm_threads, dm_hidden, dm_messages, dm_reads + RPC'leri
--  3) Sunucuyu sessize alma (server_mutes)
--  4) unread_counts(): sona "mentions" sütunu (seni anan okunmamış mesaj sayısı)
--  5) Realtime yetkileri: "user:<uid>" (kişiye özel olaylar) ve "dm-typing:<konuşma>" (DM yazıyor)
--  6) Tetikleyiciler: arkadaşlık/engel/konuşma değişince "user:<uid>" konusuna "degisti";
--     DM mesajı eklenince dm_threads.last_message_at güncellenir
--
-- Hata kodları: RPC'ler Türkçe metin yerine sabit kod atar; istemci (src/data/friends.js, dms.js)
-- Türkçeye çevirir: NO_USER, ALREADY_FRIENDS, ALREADY_SENT, SELF, TOO_MANY, BLOCKED_DM, NOT_ALLOWED.
-- Engel bilgisi sızmaz: seni engelleyen kişi için istek hatası NO_USER, DM hatası NOT_ALLOWED olur.
-- BLOCKED_DM yalnız ENGELLEYEN kişinin kendisine döner (zaten bildiği bir şey).
--
-- Uyumluluk: messages tablosuna ve RLS'ine dokunulmaz. DM mesajları ayrı tabloda: v0.3.0'ın
-- süzgeçsiz messages aboneliği DM'leri hiç görmez. unread_counts yalnız sona sütun ekler.

-- ========== 1) ARKADAŞLIK VE ENGEL ==========

-- İki kişi arasında tek satır: (user_a, user_b) küçükten büyüğe sıralı.
create table if not exists public.friendships (
  user_a uuid not null references auth.users(id) on delete cascade,
  user_b uuid not null references auth.users(id) on delete cascade,
  requester uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','accepted')),
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  primary key (user_a, user_b),
  constraint friendships_sirali check (user_a < user_b),
  constraint friendships_isteyen check (requester = user_a or requester = user_b)
);

-- user_b tarafından arama (user_a birincil anahtarla zaten indeksli)
create index if not exists friendships_user_b_idx on public.friendships (user_b);
-- Bekleyen giden istek sayımı (sınır 20)
create index if not exists friendships_requester_idx on public.friendships (requester) where status = 'pending';

alter table public.friendships enable row level security;

-- Yalnız iki taraf okur. Ekleme/güncelleme/silme politikası yok: hepsi RPC ile.
drop policy if exists friendships_select on public.friendships;
create policy friendships_select on public.friendships
  for select to authenticated
  using (user_a = auth.uid() or user_b = auth.uid());

create table if not exists public.blocks (
  blocker uuid not null references auth.users(id) on delete cascade,
  blocked uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker, blocked),
  constraint blocks_kendini check (blocker <> blocked)
);

alter table public.blocks enable row level security;

-- Yalnız engelleyen okur: engellenen kişi engellendiğini göremez. Yazma yalnız RPC ile.
drop policy if exists blocks_select on public.blocks;
create policy blocks_select on public.blocks
  for select to authenticated
  using (blocker = auth.uid());

-- İki kişi arasında (herhangi bir yönde) engel var mı?
-- Yalnız veritabanı içinde kullanılır: istemciye AÇIK DEĞİL (açık olsa herkes "X, Y'yi engellemiş mi"
-- diye sorabilirdi). security definer fonksiyonlar sahibinin yetkisiyle çağırır.
create or replace function public.engel_var(x uuid, y uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.blocks b
    where (b.blocker = x and b.blocked = y) or (b.blocker = y and b.blocked = x)
  );
$$;

revoke all on function public.engel_var(uuid, uuid) from public, anon, authenticated;

-- Arkadaşlık isteği gönderir (tam kullanıcı adıyla, büyük-küçük harf duyarsız).
-- Karşı taraf sana zaten istek göndermişse iki istek eşleşir: doğrudan arkadaş olursunuz ('accepted').
-- Dönüş: 'sent' | 'accepted'.
-- Yarış: iki kişi aynı anda birbirine istek gönderirse çift için alınan kilit onları sıraya sokar;
-- ikincisi birincinin satırını görür ve eşleşir. Tek satır, ikisi arkadaş.
create or replace function public.send_friend_request(username text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  ben uuid := auth.uid();
  ad text := btrim(coalesce(send_friend_request.username, ''));
  diger uuid;
  a uuid;
  b uuid;
  f public.friendships;
begin
  if ben is null then
    raise exception 'NOT_ALLOWED';
  end if;

  select p.id into diger from public.profiles p where lower(p.username) = lower(ad);
  if diger is null then
    raise exception 'NO_USER';
  end if;
  if diger = ben then
    raise exception 'SELF';
  end if;
  -- Engel (iki yönde de): "böyle bir kullanıcı yok" ile aynı hata. Engellenen anlamaz.
  if public.engel_var(ben, diger) then
    raise exception 'NO_USER';
  end if;

  a := least(ben, diger);
  b := greatest(ben, diger);
  -- Çift için işlem sonuna kadar süren kilit (iki yönlü aynı anda istek yarışı)
  perform pg_advisory_xact_lock(hashtextextended('friendship:' || a::text || ':' || b::text, 0));

  -- Kilitten sonra engele yeniden bak: bu arada block_user (aynı kilidi alır) bitmiş olabilir
  if public.engel_var(ben, diger) then
    raise exception 'NO_USER';
  end if;

  select * into f from public.friendships fr where fr.user_a = a and fr.user_b = b for update;
  if found then
    if f.status = 'accepted' then
      raise exception 'ALREADY_FRIENDS';
    end if;
    if f.requester = ben then
      raise exception 'ALREADY_SENT';
    end if;
    -- Karşı taraf zaten istemiş: eşleşme
    update public.friendships fr
       set status = 'accepted', accepted_at = now()
     where fr.user_a = a and fr.user_b = b;
    return 'accepted';
  end if;

  if (select count(*) from public.friendships fr
      where fr.requester = ben and fr.status = 'pending') >= 20 then
    raise exception 'TOO_MANY';
  end if;

  insert into public.friendships (user_a, user_b, requester, status)
  values (a, b, ben, 'pending');
  return 'sent';
end;
$$;

-- Gelen isteği kabul eder (isteyen karşı taraf olmalı).
create or replace function public.accept_friend_request(other uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  ben uuid := auth.uid();
begin
  if ben is null or other is null then
    raise exception 'NOT_ALLOWED';
  end if;

  -- Engelle yarışmasın: aynı çift kilidi (send_friend_request, block_user ile ortak)
  perform pg_advisory_xact_lock(hashtextextended(
    'friendship:' || least(ben, other)::text || ':' || greatest(ben, other)::text, 0));
  if public.engel_var(ben, other) then
    raise exception 'NOT_ALLOWED';
  end if;

  update public.friendships fr
     set status = 'accepted', accepted_at = now()
   where fr.user_a = least(ben, other) and fr.user_b = greatest(ben, other)
     and fr.status = 'pending' and fr.requester = other;
  if not found then
    raise exception 'NOT_ALLOWED';
  end if;
end;
$$;

-- Bekleyen isteği kaldırır: gelen isteği reddetmek ve giden isteği iptal etmek aynı çağrı.
-- İstek zaten yoksa sessizce geçer (iki cihazdan aynı anda basılabilir).
create or replace function public.decline_friend_request(other uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  ben uuid := auth.uid();
begin
  if ben is null or other is null then
    raise exception 'NOT_ALLOWED';
  end if;

  delete from public.friendships fr
   where fr.user_a = least(ben, other) and fr.user_b = greatest(ben, other)
     and fr.status = 'pending';
end;
$$;

-- Arkadaşlıktan çıkarır. Arkadaşlık zaten yoksa sessizce geçer.
create or replace function public.remove_friend(other uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  ben uuid := auth.uid();
begin
  if ben is null or other is null then
    raise exception 'NOT_ALLOWED';
  end if;

  delete from public.friendships fr
   where fr.user_a = least(ben, other) and fr.user_b = greatest(ben, other)
     and fr.status = 'accepted';
end;
$$;

-- Engeller. Arkadaşlığı ve bekleyen istekleri (iki yönde) de siler. DM konuşması ve eski mesajlar kalır.
create or replace function public.block_user(other uuid)
returns void
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
  if other = ben then
    raise exception 'SELF';
  end if;
  if other is null or not exists (select 1 from public.profiles p where p.id = other) then
    raise exception 'NO_USER';
  end if;

  -- Aynı çift kilidi: eşzamanlı istek/kabul engelden sonra arkadaşlık satırı bırakamaz
  perform pg_advisory_xact_lock(hashtextextended(
    'friendship:' || least(ben, other)::text || ':' || greatest(ben, other)::text, 0));

  insert into public.blocks (blocker, blocked)
  values (ben, other)
  on conflict (blocker, blocked) do nothing;

  delete from public.friendships fr
   where fr.user_a = least(ben, other) and fr.user_b = greatest(ben, other);
end;
$$;

-- Engeli kaldırır (yalnız kendi koyduğu engeli). Engel yoksa sessizce geçer.
create or replace function public.unblock_user(other uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'NOT_ALLOWED';
  end if;

  delete from public.blocks b where b.blocker = auth.uid() and b.blocked = other;
end;
$$;

revoke all on function public.send_friend_request(text) from public, anon;
revoke all on function public.accept_friend_request(uuid) from public, anon;
revoke all on function public.decline_friend_request(uuid) from public, anon;
revoke all on function public.remove_friend(uuid) from public, anon;
revoke all on function public.block_user(uuid) from public, anon;
revoke all on function public.unblock_user(uuid) from public, anon;
grant execute on function public.send_friend_request(text) to authenticated;
grant execute on function public.accept_friend_request(uuid) to authenticated;
grant execute on function public.decline_friend_request(uuid) to authenticated;
grant execute on function public.remove_friend(uuid) to authenticated;
grant execute on function public.block_user(uuid) to authenticated;
grant execute on function public.unblock_user(uuid) to authenticated;

-- ========== 2) ÖZEL MESAJ (DM) ==========

-- İki kişi arasında tek konuşma: (user_a, user_b) sıralı ve benzersiz.
create table if not exists public.dm_threads (
  id uuid primary key default gen_random_uuid(),
  user_a uuid not null references auth.users(id) on delete cascade,
  user_b uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  last_message_at timestamptz,
  constraint dm_threads_sirali check (user_a < user_b),
  constraint dm_threads_cift unique (user_a, user_b)
);

create index if not exists dm_threads_user_b_idx on public.dm_threads (user_b);

alter table public.dm_threads enable row level security;

-- Yalnız iki taraf okur. Oluşturma yalnız open_dm ile.
drop policy if exists dm_threads_select on public.dm_threads;
create policy dm_threads_select on public.dm_threads
  for select to authenticated
  using (user_a = auth.uid() or user_b = auth.uid());

-- DM mesajları: messages ile aynı şekil (yumuşak silme: içerik boşalır).
create table if not exists public.dm_messages (
  id bigint generated always as identity primary key,
  thread_id uuid not null references public.dm_threads(id) on delete cascade,
  author_id uuid not null references auth.users(id) on delete cascade,
  content text not null,
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  deleted_at timestamptz,
  constraint dm_messages_content_len check (
    (deleted_at is null and length(content) between 1 and 2000)
    or (deleted_at is not null and content = '')
  )
);

-- Konuşmanın mesajları (sayfalama, okunmamış sayımı)
create index if not exists dm_messages_thread_idx on public.dm_messages (thread_id, id desc);

alter table public.dm_messages enable row level security;

-- Kişiyi gizleme listesi: hidden_after_id'den yeni mesaj gelirse konuşma listede yine görünür.
create table if not exists public.dm_hidden (
  user_id uuid not null references auth.users(id) on delete cascade,
  thread_id uuid not null references public.dm_threads(id) on delete cascade,
  hidden_after_id bigint not null default 0,
  primary key (user_id, thread_id)
);

create index if not exists dm_hidden_thread_idx on public.dm_hidden (thread_id);

alter table public.dm_hidden enable row level security;

drop policy if exists dm_hidden_select on public.dm_hidden;
create policy dm_hidden_select on public.dm_hidden
  for select to authenticated
  using (user_id = auth.uid());

-- channel_reads'in DM karşılığı. Yazma yalnız mark_dm_read ile.
create table if not exists public.dm_reads (
  user_id uuid not null references auth.users(id) on delete cascade,
  thread_id uuid not null references public.dm_threads(id) on delete cascade,
  last_read_id bigint not null default 0,
  primary key (user_id, thread_id)
);

create index if not exists dm_reads_thread_idx on public.dm_reads (thread_id);

alter table public.dm_reads enable row level security;

drop policy if exists dm_reads_select on public.dm_reads;
create policy dm_reads_select on public.dm_reads
  for select to authenticated
  using (user_id = auth.uid());

-- Çağıran bu konuşmanın tarafı mı?
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
  );
$$;

-- Çağıran bu konuşmaya yazabilir mi: tarafıdır ve iki yönde de engel yoktur.
-- (Yalnız kendi konuşmaların için cevap verir; yabancı bir çift hakkında bilgi vermez.)
-- Arkadaşlık yeniden denetlenmez: konuşmanın var olması yeter (open_dm açarken denetledi).
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
      and (t.user_a = auth.uid() or t.user_b = auth.uid())
      and not public.engel_var(t.user_a, t.user_b)
  );
$$;

revoke all on function public.is_dm_participant(uuid) from public, anon;
revoke all on function public.can_send_dm(uuid) from public, anon;
grant execute on function public.is_dm_participant(uuid) to authenticated;
grant execute on function public.can_send_dm(uuid) to authenticated;

-- İki taraf okur. Gönderme doğrudan INSERT: yazar kendisi, konuşmanın tarafı, engel yok,
-- yeni satır silinmiş/düzenlenmiş olamaz. UPDATE/DELETE politikası yok: yalnız RPC.
drop policy if exists dm_messages_select on public.dm_messages;
create policy dm_messages_select on public.dm_messages
  for select to authenticated
  using (public.is_dm_participant(thread_id));
drop policy if exists dm_messages_insert on public.dm_messages;
create policy dm_messages_insert on public.dm_messages
  for insert to authenticated
  with check (
    author_id = auth.uid()
    and deleted_at is null
    and edited_at is null
    and public.can_send_dm(thread_id)
  );

-- DM'i açar: varsa döner, yoksa oluşturur. Dönüş: konuşma id'si.
--  - Engel varsa (iki yönde de) hiçbir yolda açılmaz. Eski mesajlar dm_list satırından
--    (can_send=false) açılan ekranda görünür kalır; kutu kapanır.
--  - Var olan konuşma (engel yoksa) döner; arkadaşlık yeniden denetlenmez.
--  - Yeni konuşma için: arkadaşsınız YA DA ortak bir sunucunuz var.
--  - Listeden gizlenmişse yeniden görünür.
-- Yarış: iki çağrı aynı anda gelirse benzersizlik + "on conflict" tek konuşma bırakır.
create or replace function public.open_dm(other uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  ben uuid := auth.uid();
  a uuid;
  b uuid;
  tid uuid;
begin
  if ben is null then
    raise exception 'NOT_ALLOWED';
  end if;
  if other = ben then
    raise exception 'SELF';
  end if;
  if other is null or not exists (select 1 from public.profiles p where p.id = other) then
    raise exception 'NO_USER';
  end if;

  a := least(ben, other);
  b := greatest(ben, other);

  -- Engel HER İKİ yolda da (var olan ya da yeni konuşma) önce denetlenir; engelde gizleme
  -- kaydına dokunulmaz. Engelde var olan konuşma yalnız dm_list satırından (can_send=false) okunur.
  -- Ben engellediysem bunu zaten biliyorum: BLOCKED_DM. Karşı taraf beni engellediyse
  -- "izin yok" ile aynı hata (NOT_ALLOWED): engellendiğimi anlamam.
  if exists (select 1 from public.blocks bl where bl.blocker = ben and bl.blocked = other) then
    raise exception 'BLOCKED_DM';
  end if;
  if public.engel_var(ben, other) then
    raise exception 'NOT_ALLOWED';
  end if;

  select t.id into tid from public.dm_threads t where t.user_a = a and t.user_b = b;

  if tid is null then
    if not exists (select 1 from public.friendships fr
                   where fr.user_a = a and fr.user_b = b and fr.status = 'accepted')
       and not exists (select 1 from public.server_members s1
                       join public.server_members s2 on s2.server_id = s1.server_id
                       where s1.user_id = ben and s2.user_id = other) then
      raise exception 'NOT_ALLOWED';
    end if;

    insert into public.dm_threads (user_a, user_b)
    values (a, b)
    on conflict (user_a, user_b) do nothing
    returning id into tid;

    -- Aynı anda başka bir çağrı oluşturduysa onunkini al
    if tid is null then
      select t.id into tid from public.dm_threads t where t.user_a = a and t.user_b = b;
    end if;
  end if;

  delete from public.dm_hidden h where h.user_id = ben and h.thread_id = tid;
  return tid;
end;
$$;

-- DM mesajını düzenler: yalnız yazarı, silinmemiş mesajda, engel yokken, 1–2000 karakter.
-- Düzenlenen satırı döner.
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

-- DM mesajını siler (yumuşak): yalnız yazarı. DM'de sahip kavramı yok. Engel olsa da
-- kişi kendi mesajını silebilir. Realtime bunu UPDATE olayı olarak iletir.
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
     or not public.is_dm_participant(m.thread_id) then
    raise exception 'NOT_ALLOWED';
  end if;

  update public.dm_messages dm
     set content = '', deleted_at = now()
   where dm.id = delete_dm_message.id;
end;
$$;

-- DM listesi: konuşma, karşı taraf (profil alanlarıyla), son mesaj zamanı, okunmamış sayısı
-- (başkasının yazdığı, silinmemiş; en fazla 100, istemci 99+ gösterir) ve "yazabilir mi"
-- (engel yoksa true). Gizlenenler, gizlendikten sonra yeni mesaj gelmediyse listede yok.
-- Sıra: son mesaja göre, en yenisi üstte (mesaj yoksa açılış zamanı).
create or replace function public.dm_list()
returns table (
  thread_id uuid,
  other_id uuid,
  username text,
  color text,
  avatar_url text,
  created_at timestamptz,
  last_message_at timestamptz,
  unread int,
  can_send boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select t.id, o.id, p.username, p.color, p.avatar_url, t.created_at, t.last_message_at,
         (select count(*)::int from (
            select 1 from public.dm_messages m
            where m.thread_id = t.id
              and m.id > coalesce(r.last_read_id, 0)
              and m.deleted_at is null
              and m.author_id <> auth.uid()
            limit 100
          ) x),
         not public.engel_var(t.user_a, t.user_b)
  from public.dm_threads t
  cross join lateral (
    select case when t.user_a = auth.uid() then t.user_b else t.user_a end as id
  ) o
  left join public.profiles p on p.id = o.id
  left join public.dm_reads r on r.thread_id = t.id and r.user_id = auth.uid()
  left join public.dm_hidden h on h.thread_id = t.id and h.user_id = auth.uid()
  where (t.user_a = auth.uid() or t.user_b = auth.uid())
    and (h.thread_id is null
         or exists (select 1 from public.dm_messages m2
                    where m2.thread_id = t.id and m2.id > h.hidden_after_id))
  order by coalesce(t.last_message_at, t.created_at) desc;
$$;

-- DM okundu işareti: yalnız ileri gider (daha küçük id gelirse değişmez). Taraf olmak gerekir.
create or replace function public.mark_dm_read(tid uuid, mid bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or mid is null or mid < 0 or not public.is_dm_participant(tid) then
    raise exception 'NOT_ALLOWED';
  end if;

  insert into public.dm_reads as r (user_id, thread_id, last_read_id)
  values (auth.uid(), tid, mid)
  on conflict (user_id, thread_id)
  do update set last_read_id = greatest(r.last_read_id, excluded.last_read_id);
end;
$$;

-- DM'i listeden gizler; mesajlar silinmez. Daha yeni mesaj gelince yine görünür.
create or replace function public.hide_dm(tid uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  son bigint;
begin
  if auth.uid() is null or not public.is_dm_participant(tid) then
    raise exception 'NOT_ALLOWED';
  end if;

  select coalesce(max(m.id), 0) into son from public.dm_messages m where m.thread_id = tid;

  insert into public.dm_hidden as h (user_id, thread_id, hidden_after_id)
  values (auth.uid(), tid, son)
  on conflict (user_id, thread_id)
  do update set hidden_after_id = greatest(h.hidden_after_id, excluded.hidden_after_id);
end;
$$;

revoke all on function public.open_dm(uuid) from public, anon;
revoke all on function public.edit_dm_message(bigint, text) from public, anon;
revoke all on function public.delete_dm_message(bigint) from public, anon;
revoke all on function public.dm_list() from public, anon;
revoke all on function public.mark_dm_read(uuid, bigint) from public, anon;
revoke all on function public.hide_dm(uuid) from public, anon;
grant execute on function public.open_dm(uuid) to authenticated;
grant execute on function public.edit_dm_message(bigint, text) to authenticated;
grant execute on function public.delete_dm_message(bigint) to authenticated;
grant execute on function public.dm_list() to authenticated;
grant execute on function public.mark_dm_read(uuid, bigint) to authenticated;
grant execute on function public.hide_dm(uuid) to authenticated;

-- DM mesajları realtime yayınında (tek süzgeçsiz abonelik; hangi satırın kime gideceğine RLS
-- karar verir). Yeniden çalıştırılırsa hata vermesin diye önce bakılır.
do $$
begin
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'dm_messages') then
    alter publication supabase_realtime add table public.dm_messages;
  end if;
end;
$$;

-- ========== 3) SUNUCUYU SESSİZE ALMA ==========

create table if not exists public.server_mutes (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  server_id uuid not null references public.servers(id) on delete cascade,
  primary key (user_id, server_id)
);

create index if not exists server_mutes_server_idx on public.server_mutes (server_id);

alter table public.server_mutes enable row level security;

-- Yalnız kendi satırları. Eklerken sunucunun üyesi olmalı.
drop policy if exists server_mutes_select on public.server_mutes;
create policy server_mutes_select on public.server_mutes
  for select to authenticated
  using (user_id = auth.uid());
drop policy if exists server_mutes_insert on public.server_mutes;
create policy server_mutes_insert on public.server_mutes
  for insert to authenticated
  with check (user_id = auth.uid() and public.is_member(server_id));
drop policy if exists server_mutes_delete on public.server_mutes;
create policy server_mutes_delete on public.server_mutes
  for delete to authenticated
  using (user_id = auth.uid());

-- ========== 4) @BAHSETME VE unread_counts ==========

-- Metin bu kullanıcı adını anıyor mu? Kural (istemcideki src/mentions.js ile AYNI olmalı):
--  - "@" + kullanıcı adı, büyük-küçük harf duyarsız.
--  - Kelime sınırı: "@"tan önce metnin başı ya da harf/rakam/_ OLMAYAN bir karakter; addan sonra
--    metnin sonu ya da harf/rakam/_ OLMAYAN bir karakter. Yani "@berk", "@berkcan"ı anmaz;
--    "a@berk" (e-posta gibi) de anmaz.
--  - Kullanıcı adında her karakter olabilir (001: yalnız 3–20 uzunluk kısıtı var), bu yüzden
--    addaki harf/rakam dışı her karakter düzenli ifadede "\" ile kaçırılır (ARE'de "\" + harf/rakam
--    olmayan karakter o karakterin kendisidir).
-- immutable: yalnız girdilerine bakar, hiçbir tabloya dokunmaz.
create or replace function public.mentions_user(metin text, ad text)
returns boolean
language sql
immutable
security definer
set search_path = public
as $$
  select metin ~* (
    '(^|[^[:alnum:]_])@'
    || regexp_replace(ad, '([^[:alnum:]])', '\\\1', 'g')
    || '($|[^[:alnum:]_])'
  );
$$;

revoke all on function public.mentions_user(text, text) from public, anon;
grant execute on function public.mentions_user(text, text) to authenticated;

-- Dönüş tipi değiştiği için önce kaldırılır. Sütunlar v0.3.0 ile AYNI sırada; yalnız sona
-- "mentions" eklendi (eski istemciler fazladan sütunu yok sayar).
-- count: 006'daki gibi. mentions: kanal başına en yeni 100 okunmamış mesaj taranır (düzenli
-- ifade maliyeti sınırlı kalsın), bunlardan seni ananlar sayılır. "@" içermeyen mesajlar ucuz
-- ön süzgeçle (like) baştan elenir.
drop function if exists public.unread_counts();
create function public.unread_counts()
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
            select m.content from public.messages m
            where m.channel_id = c.id
              and m.id > t.taban
              and m.deleted_at is null
              and m.author_id <> auth.uid()
            order by m.id desc
            limit 100
          ) y
          where y.content like '%@%'
            and public.mentions_user(y.content, ben.username))
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

-- ========== 5) REALTIME YETKİLERİ ==========

-- "user:<uid>": kişiye özel olaylar (arkadaşlık, engel, yeni DM). Yalnız kişinin kendisi ALIR.
-- Gönderme politikası yok (yasak): yayını yalnız veritabanı tetikleyicileri gönderir.
drop policy if exists user_receive on realtime.messages;
create policy user_receive on realtime.messages
  for select to authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and realtime.topic() = 'user:' || auth.uid()::text
  );

-- "dm-typing:<konuşma uuid>": iki taraf alır; gönderen ayrıca engelsiz olmalı (yazma = yazabilmek).
-- Bozuk konu (uuid değilse) hata fırlatmaz, false döner.
create or replace function public.can_access_dm_topic(topic text, gonderim boolean)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  tid uuid;
begin
  if topic is null
     or topic !~* '^dm-typing:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;
  tid := substring(topic from 11)::uuid; -- "dm-typing:" (10 karakter) sonrası
  if gonderim then
    return public.can_send_dm(tid);
  end if;
  return public.is_dm_participant(tid);
end;
$$;

revoke all on function public.can_access_dm_topic(text, boolean) from public, anon;
grant execute on function public.can_access_dm_topic(text, boolean) to authenticated;

-- DM yazıyor: yalnız yayın (broadcast). Veritabanına satır yazılmaz.
drop policy if exists dm_typing_receive on realtime.messages;
create policy dm_typing_receive on realtime.messages
  for select to authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and public.can_access_dm_topic(realtime.topic(), false)
  );
drop policy if exists dm_typing_send on realtime.messages;
create policy dm_typing_send on realtime.messages
  for insert to authenticated
  with check (
    realtime.messages.extension = 'broadcast'
    and public.can_access_dm_topic(realtime.topic(), true)
  );

-- ========== 6) TETİKLEYİCİLER ==========

-- friendships (ekleme/güncelleme/silme) ve dm_threads (ekleme/silme) değişince İKİ tarafın
-- "user:<uid>" konusuna "degisti" gider; blocks değişince yalnız ENGELLEYENE (diğer cihazları için;
-- engellenene gitmez, öğrenmesin). Alan istemci arkadaş ve DM listelerini yeniden alır.
-- Yayın gönderilemezse işlem bozulmaz (hata yutulur; yedek: pencere odağında tazeleme).
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
  else
    kisiler := array[(satir ->> 'user_a')::uuid, (satir ->> 'user_b')::uuid];
  end if;

  foreach kisi in array kisiler loop
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

revoke all on function public.kisi_olayi_gonder() from public, anon;
grant execute on function public.kisi_olayi_gonder() to authenticated;

drop trigger if exists friendships_degisti on public.friendships;
create trigger friendships_degisti
  after insert or update or delete on public.friendships
  for each row execute function public.kisi_olayi_gonder();

-- Yalnız yeni konuşma ve silinme: her mesajdaki last_message_at güncellemesi olay üretmez
-- (yeni mesajı DM aboneliği zaten getirir).
drop trigger if exists dm_threads_degisti on public.dm_threads;
create trigger dm_threads_degisti
  after insert or delete on public.dm_threads
  for each row execute function public.kisi_olayi_gonder();

drop trigger if exists blocks_degisti on public.blocks;
create trigger blocks_degisti
  after insert or delete on public.blocks
  for each row execute function public.kisi_olayi_gonder();

-- DM mesajı eklenince konuşmanın son mesaj zamanı güncellenir (liste sıralaması için).
create or replace function public.dm_son_mesaj_guncelle()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    update public.dm_threads t
       set last_message_at = now() -- created_at istemciden gelebilir; sunucu saati esas
     where t.id = new.thread_id;
  exception when others then
    null; -- güncellenemedi: mesaj yine de gider
  end;
  return null;
end;
$$;

revoke all on function public.dm_son_mesaj_guncelle() from public, anon;
grant execute on function public.dm_son_mesaj_guncelle() to authenticated;

drop trigger if exists dm_messages_son_mesaj on public.dm_messages;
create trigger dm_messages_son_mesaj
  after insert on public.dm_messages
  for each row execute function public.dm_son_mesaj_guncelle();
