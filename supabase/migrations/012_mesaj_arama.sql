-- 012: Mesaj arama (v0.10.0).
-- Bu dosyada:
--  1) Eklentiler: unaccent ve pg_trgm, "extensions" şemasında (Supabase'in eklenti şeması)
--  2) arama_metni(t): Türkçe büyük-küçük harf ve aksan duyarsız normal biçim (İ/I/ı → i, ş → s, ...)
--  3) Trigram GIN indeksleri: messages ve dm_messages (kısmi: silinmişler ve DM sistem satırları girmez)
--  4) search_messages(...): yalnız çağıranın görebildiği mesajlarda arama (sunucu üyeliği, DM tarafı,
--     ŞU AN üye olunan grup), en yeniden eskiye, imleçle sayfalı
--
-- Hata kodları (istemci src/data/search.js Türkçeye çevirir): NOT_ALLOWED, TOO_SHORT, BAD_QUERY.
-- Engel: DM'lerde mevcut görünürlük aynen (engelli bire bir konuşmanın eski mesajları DM'de görünür; aramada da).
--
-- Uyumluluk (v0.9.0):
--  - Yeni tablo, sütun, politika ya da olay yok. Mevcut RPC'ler değişmez.
--  - İndeks ifadesi (arama_metni) her mesaj eklemede ekleyen kişinin yetkisiyle çalışır: eski istemcinin
--    doğrudan INSERT'i de çalışsın diye authenticated'a (ve yönetici betikleri için service_role'e) açıktır.
--    Fonksiyon yalnız metin döndürür; hiçbir tabloyu okumaz.

-- ========== 1) EKLENTİLER ==========

create extension if not exists unaccent with schema extensions;
create extension if not exists pg_trgm with schema extensions;

-- Eklenti daha önce başka bir şemaya kurulduysa "if not exists" bir şey yapmaz. Aşağıdaki fonksiyon ve
-- indeks şemayı adıyla (extensions.) kullandığı için yerini denetleriz: başka yerdeyse taşımayı deneriz,
-- olmazsa açık bir hatayla dururuz (sessizce yanlış şemaya bağlanmaz).
do $$
declare
  ad text;
begin
  foreach ad in array array['unaccent', 'pg_trgm'] loop
    if not exists (
      select 1 from pg_extension e join pg_namespace n on n.oid = e.extnamespace
      where e.extname = ad and n.nspname = 'extensions'
    ) then
      begin
        execute format('alter extension %I set schema extensions', ad);
      exception when others then
        raise exception '% eklentisi extensions şemasında değil ve taşınamadı: %', ad, sqlerrm;
      end;
    end if;
  end loop;
end $$;

-- ========== 2) NORMAL BİÇİM ==========

-- Aramada iki taraf da bu biçime çevrilir. Sıra önemli:
--  1) translate: İ, I ve ı → i. Türkçe I/ı ile İ/i'yi ayırmıyoruz ("ılık" yazan "Ilık"ı da bulsun);
--     lower('İ') bazı yerel ayarlarda "i + birleşik nokta" verir, bu yüzden lower'dan ÖNCE çevrilir.
--  2) unaccent: ş→s, ğ→g, ç→c, ö→o, ü→u, â→a ... (sözlük adı şemayla: search_path'e bağlı değil)
--  3) lower
-- immutable: indeks ifadesinde kullanılabilsin diye (sözlük sabit; Supabase'de değişmez).
create or replace function public.arama_metni(t text)
returns text
language sql
immutable
parallel safe
security definer
set search_path = public
as $$
  select lower(extensions.unaccent('extensions.unaccent'::regdictionary, translate(t, 'İIı', 'iii')));
$$;

revoke all on function public.arama_metni(text) from public, anon;
grant execute on function public.arama_metni(text) to authenticated, service_role;

-- ========== 3) İNDEKSLER ==========

-- Trigram GIN indeksi ILIKE '%parça%' aramasını hızlandırır. Kısmi: silinen mesajlar ve DM'deki arama kaydı,
-- sabit ve grup sistem satırları indekse girmez (aranmazlar). Boyut tahmini tasarım belgesinde.
create index if not exists messages_arama_idx on public.messages
  using gin (public.arama_metni(content) extensions.gin_trgm_ops)
  where deleted_at is null;

create index if not exists dm_messages_arama_idx on public.dm_messages
  using gin (public.arama_metni(content) extensions.gin_trgm_ops)
  where deleted_at is null and kind = 'text';

-- ========== 4) ARAMA ==========

-- sorgu: aranan metin (filtreler istemcide ayrıştırılır). Boşluklarla kelimelere bölünür; her kelime geçmeli.
-- sunucu: doluysa o sunucunun metin kanallarında; boşsa çağıranın bütün DM'lerinde ve gruplarında aranır.
-- kanal_adi: yalnız sunucuda; normal biçimi eşit olan metin kanalları (baştaki # atılır).
-- yazar_adi: kullanıcı adı (büyük-küçük harf duyarsız; baştaki @ atılır). Yoksa boş sonuç.
-- once_tarih: bu andan önce yazılanlar. sonra_tarih: bu andan itibaren yazılanlar (istemci gün sınırını verir).
-- ekli: true ise yalnız eki olanlar.
-- oncesi: sayfalama imleci (bu id'den eskiler). sinir: 1–50 (varsayılan 25).
-- Dönüş: en yeniden eskiye. yer_adi: kanal adı / bire birde karşı tarafın adı / grubun adı (adsızsa diğer
-- üyelerin adları virgülle; istemcideki grupAdi ile aynı).
create or replace function public.search_messages(
  sorgu text,
  sunucu uuid default null,
  kanal_adi text default null,
  yazar_adi text default null,
  once_tarih timestamptz default null,
  sonra_tarih timestamptz default null,
  ekli boolean default null,
  oncesi bigint default null,
  sinir integer default 25
)
returns table (
  id bigint,
  tur text,
  channel_id uuid,
  server_id uuid,
  thread_id uuid,
  is_group boolean,
  yer_adi text,
  other_id uuid,
  author_id uuid,
  author_name text,
  content text,
  created_at timestamptz,
  attachment_count smallint
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  ben uuid := auth.uid();
  metin text;
  kelimeler text[];
  desenler text[];
  ana text;
  n integer := least(greatest(coalesce(sinir, 25), 1), 50);
  yazar uuid;
  kanal_n text := nullif(public.arama_metni(btrim(ltrim(btrim(coalesce(kanal_adi, '')), '#'))), '');
  yazar_t text := nullif(btrim(ltrim(btrim(coalesce(yazar_adi, '')), '@')), '');
  filtre_var boolean;
  kanallar uuid[];
  konusmalar uuid[];
begin
  if ben is null then raise exception 'NOT_ALLOWED'; end if;
  if char_length(coalesce(sorgu, '')) > 200 then raise exception 'BAD_QUERY'; end if;

  metin := public.arama_metni(btrim(coalesce(sorgu, '')));
  kelimeler := array(select distinct k from regexp_split_to_table(metin, '\s+') k where k <> '');
  if cardinality(kelimeler) > 8 then raise exception 'BAD_QUERY'; end if;
  filtre_var := yazar_t is not null or (sunucu is not null and kanal_n is not null)
    or once_tarih is not null or sonra_tarih is not null or coalesce(ekli, false);
  -- En az 2 karakter (boşluksuz); metin yoksa en az bir filtre
  if char_length(array_to_string(kelimeler, '')) < 2
     and (cardinality(kelimeler) > 0 or not filtre_var) then
    raise exception 'TOO_SHORT';
  end if;

  -- LIKE desenleri: \ % _ kaçırılır. En uzun kelime indeksle süzülür, hepsi satırda denetlenir.
  desenler := array(select '%' || replace(replace(replace(k, '\', '\\'), '%', '\%'), '_', '\_') || '%' from unnest(kelimeler) k);
  ana := (select d from unnest(desenler) d order by char_length(d) desc, d limit 1);

  if yazar_t is not null then
    select p.id into yazar from public.profiles p
    where lower(p.username) = lower(yazar_t)
    order by (p.username = yazar_t) desc
    limit 1;
    if yazar is null then return; end if;
  end if;

  -- ---- Sunucu: o sunucunun metin kanalları ----
  if sunucu is not null then
    if not exists (select 1 from public.server_members sm where sm.server_id = sunucu and sm.user_id = ben) then
      raise exception 'NOT_ALLOWED';
    end if;
    kanallar := array(
      select c.id from public.channels c
      where c.server_id = sunucu and c.kind = 'text'
        and (kanal_n is null or public.arama_metni(c.name) = kanal_n));
    if cardinality(kanallar) = 0 then return; end if;

    if ana is not null then
      return query
      with bulunan as (
        select m.id from public.messages m
        where m.channel_id = any (kanallar)
          and m.deleted_at is null
          and public.arama_metni(m.content) ilike ana
          and not exists (select 1 from unnest(desenler) d where not (public.arama_metni(m.content) ilike d))
          and not (m.attachment_count > 0 and m.content = '📎 dosya')
          and (yazar is null or m.author_id = yazar)
          and (once_tarih is null or m.created_at < once_tarih)
          and (sonra_tarih is null or m.created_at >= sonra_tarih)
          and (not coalesce(ekli, false) or m.attachment_count > 0)
          and (oncesi is null or m.id < oncesi)
        order by m.id desc limit n
      )
      select m.id, 'channel'::text, m.channel_id, sunucu, null::uuid, false, c.name, null::uuid,
             m.author_id, p.username, m.content, m.created_at, m.attachment_count
      from bulunan b
      join public.messages m on m.id = b.id
      join public.channels c on c.id = m.channel_id
      left join public.profiles p on p.id = m.author_id
      order by m.id desc;
    else
      return query
      with bulunan as (
        select m.id from public.messages m
        where m.channel_id = any (kanallar)
          and m.deleted_at is null
          and (yazar is null or m.author_id = yazar)
          and (once_tarih is null or m.created_at < once_tarih)
          and (sonra_tarih is null or m.created_at >= sonra_tarih)
          and (not coalesce(ekli, false) or m.attachment_count > 0)
          and (oncesi is null or m.id < oncesi)
        order by m.id desc limit n
      )
      select m.id, 'channel'::text, m.channel_id, sunucu, null::uuid, false, c.name, null::uuid,
             m.author_id, p.username, m.content, m.created_at, m.attachment_count
      from bulunan b
      join public.messages m on m.id = b.id
      join public.channels c on c.id = m.channel_id
      left join public.profiles p on p.id = m.author_id
      order by m.id desc;
    end if;
    return;
  end if;

  -- ---- Ana sayfa: bire bir konuşmalar (taraf) + şu an üyesi olunan gruplar ----
  -- Gruptan ayrılan/çıkarılan kişinin dm_members satırı yoktur: o grubun mesajları gelmez.
  konusmalar := array(
    select t.id from public.dm_threads t
    where not t.is_group and (t.user_a = ben or t.user_b = ben)
    union all
    select dm.thread_id from public.dm_members dm join public.dm_threads t on t.id = dm.thread_id where dm.user_id = ben and t.is_group);
  if cardinality(konusmalar) = 0 then return; end if;

  if ana is not null then
    return query
    with bulunan as (
      select m.id from public.dm_messages m
      where m.thread_id = any (konusmalar)
        and m.deleted_at is null
        and m.kind = 'text'
        and public.arama_metni(m.content) ilike ana
        and not exists (select 1 from unnest(desenler) d where not (public.arama_metni(m.content) ilike d))
        and not (m.attachment_count > 0 and m.content = '📎 dosya')
        and (yazar is null or m.author_id = yazar)
        and (once_tarih is null or m.created_at < once_tarih)
        and (sonra_tarih is null or m.created_at >= sonra_tarih)
        and (not coalesce(ekli, false) or m.attachment_count > 0)
        and (oncesi is null or m.id < oncesi)
      order by m.id desc limit n
    )
    select m.id, 'dm'::text, null::uuid, null::uuid, m.thread_id, t.is_group,
           case when t.is_group then coalesce(t.name, (
                  select string_agg(p2.username, ', ' order by g.joined_at, g.user_id)
                  from public.dm_members g join public.profiles p2 on p2.id = g.user_id
                  where g.thread_id = t.id and g.user_id <> ben), 'Grup')
                else (select p3.username from public.profiles p3
                      where p3.id = case when t.user_a = ben then t.user_b else t.user_a end)
           end,
           case when t.is_group then null::uuid when t.user_a = ben then t.user_b else t.user_a end,
           m.author_id, p.username, m.content, m.created_at, m.attachment_count
    from bulunan b
    join public.dm_messages m on m.id = b.id
    join public.dm_threads t on t.id = m.thread_id
    left join public.profiles p on p.id = m.author_id
    order by m.id desc;
  else
    return query
    with bulunan as (
      select m.id from public.dm_messages m
      where m.thread_id = any (konusmalar)
        and m.deleted_at is null
        and m.kind = 'text'
        and (yazar is null or m.author_id = yazar)
        and (once_tarih is null or m.created_at < once_tarih)
        and (sonra_tarih is null or m.created_at >= sonra_tarih)
        and (not coalesce(ekli, false) or m.attachment_count > 0)
        and (oncesi is null or m.id < oncesi)
      order by m.id desc limit n
    )
    select m.id, 'dm'::text, null::uuid, null::uuid, m.thread_id, t.is_group,
           case when t.is_group then coalesce(t.name, (
                  select string_agg(p2.username, ', ' order by g.joined_at, g.user_id)
                  from public.dm_members g join public.profiles p2 on p2.id = g.user_id
                  where g.thread_id = t.id and g.user_id <> ben), 'Grup')
                else (select p3.username from public.profiles p3
                      where p3.id = case when t.user_a = ben then t.user_b else t.user_a end)
           end,
           case when t.is_group then null::uuid when t.user_a = ben then t.user_b else t.user_a end,
           m.author_id, p.username, m.content, m.created_at, m.attachment_count
    from bulunan b
    join public.dm_messages m on m.id = b.id
    join public.dm_threads t on t.id = m.thread_id
    left join public.profiles p on p.id = m.author_id
    order by m.id desc;
  end if;
end;
$$;

revoke all on function public.search_messages(text, uuid, text, text, timestamptz, timestamptz, boolean, bigint, integer) from public, anon;
grant execute on function public.search_messages(text, uuid, text, text, timestamptz, timestamptz, boolean, bigint, integer) to authenticated;
