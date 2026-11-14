// Çevrimdışı şema testi (tests/schema.test.js kalıbı): 010 dosya ve resim ekleri (v0.8.0)
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { YASAK_UZANTILAR, YASAK_MIMELER, DEPO_TURLERI, YER_TUTUCU, DOSYA_SINIRI, KOTA, EN_FAZLA_EK, EK_KOVASI } from '../src/data/ekKurallari.js'

const yol = 'supabase/migrations/010_ekler.sql'
const ham = existsSync(yol) ? readFileSync(yol, 'utf8') : ''
const sql = ham.toLowerCase().replace(/\s+/g, ' ')
const fonk = (ad) => {
  const i = sql.search(new RegExp(`create (or replace )?function public\\.${ad}\\(`))
  if (i < 0) return ''
  const govdeBasi = sql.indexOf('$$', i)
  return sql.slice(i, sql.indexOf('$$;', govdeBasi + 2) + 3)
}
const politika = (ad) => {
  const i = sql.indexOf(`create policy ${ad} `)
  if (i < 0) return ''
  return sql.slice(i, sql.indexOf(';', i) + 1)
}
// Fonksiyon gövdesindeki ARRAY[...] içindeki tırnaklı değerler (sıra korunur)
const dizi = (govde, n) => {
  const parcalar = govde.split('array[').slice(1)
  const p = parcalar[n] ?? ''
  return [...p.slice(0, p.indexOf(']')).matchAll(/'([^']+)'/g)].map((x) => x[1])
}

describe('010_ekler.sql', () => {
  it('dosya var', () => expect(existsSync(yol)).toBe(true))

  it('attachment_count: iki tabloya varsayılanlı (0), 0–4; sütun silme/yeniden adlandırma yok', () => {
    expect(sql).toContain('alter table public.messages add column if not exists attachment_count smallint not null default 0 check (attachment_count between 0 and 4)')
    expect(sql).toContain('alter table public.dm_messages add column if not exists attachment_count smallint not null default 0 check (attachment_count between 0 and 4)')
    expect(sql).not.toMatch(/drop column|rename column|rename to/)
  })

  it('içerik kısıtlarına, INSERT politikalarına, edit/delete RPC\'lerine, dm_list ve unread_counts\'a dokunulmaz', () => {
    expect(sql).not.toMatch(/drop constraint/)
    expect(sql).not.toMatch(/create policy \w+ on public\.(messages|dm_messages)/)
    for (const f of ['edit_message', 'delete_message', 'edit_dm_message', 'delete_dm_message', 'dm_list', 'unread_counts']) {
      expect(fonk(f)).toBe('')
    }
  })

  it('attachments: alanlar, tam bir mesaj, cascade, benzersiz yol, boyut sınırı', () => {
    expect(sql).toContain('create table if not exists public.attachments (')
    for (const s of [
      'id bigint generated always as identity primary key',
      'message_id bigint references public.messages(id) on delete cascade',
      'dm_message_id bigint references public.dm_messages(id) on delete cascade',
      'uploader uuid not null references auth.users(id) on delete cascade',
      'path text not null unique',
      'name text not null check (length(name) between 1 and 255)',
      'size bigint not null check (size between 0 and 8388608)',
      'width integer', 'height integer', 'created_at timestamptz not null default now()',
      'check (num_nonnulls(message_id, dm_message_id) = 1)',
    ]) expect(sql).toContain(s)
    expect(DOSYA_SINIRI).toBe(8388608)
  })

  it('attachments RLS açık; yalnız SELECT (mesajı gören eki görür); yazma politikası yok', () => {
    expect(sql).toContain('alter table public.attachments enable row level security')
    const p = politika('attachments_select')
    expect(p).toContain('for select to authenticated')
    expect(p).toContain('public.is_member(c.server_id)')
    expect(p).toContain('public.is_dm_participant(m.thread_id)')
    expect(p).toContain('m.id = message_id')
    expect(p).toContain('m.id = dm_message_id')
    expect(sql).not.toMatch(/create policy \w+ on public\.attachments for (insert|update|delete|all)/)
  })

  it('kova: özel, adı "ekler", 8 MB, depoda yalnız resim + octet-stream (istemciyle aynı liste)', () => {
    expect(EK_KOVASI).toBe('ekler')
    expect(sql).toContain("insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values ('ekler', 'ekler', false, 8388608,")
    expect(sql).toContain('set public = false')
    const i = ham.indexOf('insert into storage.buckets')
    const turler = [...ham.slice(i, ham.indexOf(']', i)).matchAll(/'([^']+)'/g)].map((x) => x[1]).slice(2)
    expect(turler).toEqual(DEPO_TURLERI)
  })

  it('storage politikaları: okuma ek_okunabilir, yükleme ek_yuklenebilir, silme ek_silinebilir; güncelleme yok', () => {
    expect(politika('ekler_select')).toContain("on storage.objects for select to authenticated using (bucket_id = 'ekler' and public.ek_okunabilir(name))")
    expect(politika('ekler_insert')).toContain("on storage.objects for insert to authenticated with check (bucket_id = 'ekler' and public.ek_yuklenebilir(name))")
    expect(politika('ekler_delete')).toContain("on storage.objects for delete to authenticated using (bucket_id = 'ekler' and public.ek_silinebilir(name))")
    expect(sql).not.toMatch(/create policy ekler_\w+ on storage\.objects for (update|all)/)
    for (const ad of ['ekler_select', 'ekler_insert', 'ekler_delete']) expect(sql).toContain(`drop policy if exists ${ad} on storage.objects`)
  })

  it('ek_silinebilir: kendi klasörü; sunucu sahibi yalnız mesaja BAĞLI OLMAYAN kanal nesnesini (moderasyon)', () => {
    const f = fonk('ek_silinebilir')
    expect(f).toContain('storage.foldername(yol)')
    expect(f).toContain('p[3] = auth.uid()::text')
    expect(f).toContain("p[1] <> 'k'")
    expect(f).toContain('s.owner_id = auth.uid()')
    expect(f).toContain('and not exists (select 1 from public.attachments a where a.path = yol)')
  })

  it('ek_okunabilir: başkasının dosyası yalnız mesaja bağlıysa (attachments satırı) okunur; gönderilmemiş/silinmiş okunmaz', () => {
    const f = fonk('ek_okunabilir')
    expect(f).toContain('public.ek_silinebilir(yol)')
    expect(f).toContain('if not exists (select 1 from public.attachments a where a.path = yol) then return false')
    // bağ denetimi kendi klasörü kuralından SONRA, üyelik denetiminden ÖNCE
    expect(f.indexOf('p[3] = auth.uid()::text')).toBeLessThan(f.indexOf('from public.attachments'))
    expect(f.indexOf('from public.attachments')).toBeLessThan(f.indexOf("p[1] = 'k'"))
  })

  it('ek_okunabilir: storage.foldername ile 3 parça; kendi klasörü; k -> üye, d -> taraf', () => {
    const f = fonk('ek_okunabilir')
    expect(f).toContain('storage.foldername(yol)')
    expect(f).toContain('array_length(p, 1), 0) <> 3')
    expect(f).toContain('p[3] = auth.uid()::text')
    expect(f).toContain("p[1] = 'k'")
    expect(f).toContain('public.is_member(c.server_id)')
    expect(f).toContain("p[1] = 'd'")
    expect(f).toContain('public.is_dm_participant(hedef)')
  })

  it('ek_yuklenebilir: yalnız kendi klasörü, yasaklı uzantı yok, depo kotası, DM\'de can_send_dm (engel)', () => {
    const f = fonk('ek_yuklenebilir')
    expect(f).toContain('p[3] <> auth.uid()::text')
    expect(f).toContain('public.ek_turu_yasak(yol, null)')
    expect(f).toContain('public.ek_depo_kullanimi(auth.uid()) >= 157286400')
    expect(f).toContain('public.can_send_dm(hedef)')
    expect(f).toContain('public.is_member(c.server_id)')
    expect(KOTA).toBe(157286400)
  })

  it('yasaklı uzantı ve MIME listeleri istemciyle AYNI', () => {
    const f = ham.slice(ham.indexOf('function public.ek_turu_yasak'), ham.indexOf('$$;', ham.indexOf('function public.ek_turu_yasak')))
    expect(dizi(f, 0)).toEqual(YASAK_UZANTILAR)
    expect(dizi(f, 1)).toEqual(YASAK_MIMELER)
    expect(YASAK_UZANTILAR).toEqual(['exe', 'msi', 'bat', 'cmd', 'ps1', 'sh', 'js', 'vbs', 'scr', 'jar', 'html', 'htm', 'svg'])
    expect(fonk('ek_turu_yasak')).toContain('immutable')
  })

  it('uzantıdan önce sondaki nokta/boşluk kırpılır; gizli karakterli (U+202E vb.) ad yasaklı', () => {
    expect(fonk('ek_uzanti')).toContain("regexp_replace(coalesce(ad, ''), '[.[:space:]]+$', '')")
    expect(fonk('ek_turu_yasak')).toContain('public.ek_adi_gizli_karakterli(ad) or')
    const g = ham.slice(ham.indexOf('function public.ek_adi_gizli_karakterli'))
    for (const k of [String.raw`\u202a-\u202e`, String.raw`\u200b-\u200f`, String.raw`\x01-\x1f`, String.raw`\ufeff`, String.raw`\u2066-\u206f`]) expect(g).toContain(k)
  })

  it('gönderme RPC\'leri: mesaj + ekler tek işlemde; yer tutucu "📎 dosya"; ek sayısı', () => {
    const k = fonk('send_message_with_attachments')
    expect(k).toContain('returns public.messages')
    expect(k).toContain('public.is_member(c.server_id)')
    expect(k).toContain("raise exception 'reply_gone'")
    expect(k).toContain('public.reply_ok(yanit, cid)')
    expect(k).toContain("public.ekleri_denetle(ekler, 'k/' || cid::text || '/' || ben::text || '/')")
    expect(k).toContain('insert into public.messages (channel_id, author_id, content, reply_to, attachment_count)')
    expect(k).toContain('public.ekleri_yaz(ekler, m.id, null)')
    const d = fonk('send_dm_with_attachments')
    expect(d).toContain('returns public.dm_messages')
    expect(d).toContain("raise exception 'blocked_dm'")
    expect(d).toContain('public.engel_var(t.user_a, t.user_b)')
    expect(d).toContain('public.dm_reply_ok(yanit, tid)')
    expect(d).toContain("public.ekleri_denetle(ekler, 'd/' || tid::text || '/' || ben::text || '/')")
    expect(d).toContain('public.ekleri_yaz(ekler, null, m.id)')
    // Yer tutucu istemcideki sabitle aynı
    expect(ham.match(new RegExp(`'${YER_TUTUCU}'`, 'g'))?.length).toBe(2)
  })

  it('ekleri_denetle: 1–4 ek, yol öneki, depodaki gerçek boyut/tür, tür kuralları, kota (attachments), danışma kilidi', () => {
    const f = fonk('ekleri_denetle')
    expect(f).toContain("raise exception 'too_many'")
    expect(f).toContain('> 4')
    expect(EN_FAZLA_EK).toBe(4)
    expect(f).toContain('left(yol, length(onek)) <> onek')
    expect(f).toContain("from storage.objects so where so.bucket_id = 'ekler' and so.name = yol")
    expect(f).toContain("o.metadata ->> 'size'")
    expect(f).toContain("o.metadata ->> 'mimetype'")
    expect(f).toContain("raise exception 'too_large'")
    expect(f).toContain("raise exception 'blocked_type'")
    expect(f).toContain('from public.attachments a where a.uploader = ben')
    expect(f).toContain("raise exception 'quota'")
    expect(f).toContain('pg_advisory_xact_lock')
    // aynı yol dizide iki kez: temiz hata (unique ihlali değil), kota iki kez sayılmaz
    expect(f).toContain("if yol = any (gorulen) then raise exception 'bad_attachment'")
  })

  it('ek_kullanimim ve yetim_eklerim: yalnız kendi; yetim 1 saatten eski, mesaja bağlı değil, en çok 100', () => {
    const k = fonk('ek_kullanimim')
    expect(k).toContain('a.uploader = auth.uid()')
    expect(k).toContain('public.ek_depo_kullanimi(auth.uid())')
    const y = fonk('yetim_eklerim')
    expect(y).toContain('(storage.foldername(o.name))[3] = auth.uid()::text')
    expect(y).toContain("interval '1 hour'")
    expect(y).toContain('not exists (select 1 from public.attachments a where a.path = o.name)')
    expect(y).toContain('limit 100')
    // depodaki nesne SQL ile silinmez (dosya depoda kalırdı); silme Storage API ile
    expect(sql).not.toMatch(/delete from storage\.objects/)
  })

  it('yumuşak silmede ek satırları da silinir (009 fonksiyonu genişler)', () => {
    const f = fonk('mesaj_silinince_temizle')
    expect(f).toContain('delete from public.attachments a where a.message_id = new.id')
    expect(f).toContain('delete from public.attachments a where a.dm_message_id = new.id')
    expect(f).toContain('delete from public.message_reactions r where r.message_id = new.id')
    expect(f).toContain('delete from public.dm_message_pins p where p.message_id = new.id')
  })

  it('her fonksiyon: security definer, search_path, revoke public/anon; dışa açık olanlar authenticated\'a grant', () => {
    const adlar = [...sql.matchAll(/create or replace function public\.(\w+)\(/g)].map((x) => x[1])
    expect(adlar.length).toBeGreaterThanOrEqual(11)
    for (const ad of adlar) {
      const f = fonk(ad)
      expect(f, ad).toContain('security definer')
      expect(f, ad).toContain('set search_path = public')
      expect(sql, ad).toMatch(new RegExp(`revoke all on function public\\.${ad}\\([^)]*\\) from public, anon`))
    }
    for (const ad of ['send_message_with_attachments', 'send_dm_with_attachments', 'ek_kullanimim', 'yetim_eklerim', 'ek_okunabilir', 'ek_yuklenebilir', 'ek_silinebilir']) {
      expect(sql, ad).toMatch(new RegExp(`grant execute on function public\\.${ad}\\([^)]*\\) to authenticated`))
    }
    // İç yardımcılar istemciye kapalı (başkasının kullanımı sorulamaz)
    for (const ad of ['ek_depo_kullanimi', 'ekleri_denetle', 'ekleri_yaz']) {
      expect(sql, ad).toMatch(new RegExp(`revoke all on function public\\.${ad}\\([^)]*\\) from public, anon, authenticated`))
    }
  })
})
