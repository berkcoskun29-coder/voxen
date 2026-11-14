// Çevrimdışı şema testi (tests/schema.test.js kalıbı): 012 mesaj arama (v0.10.0)
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { ARAMA_SAYFA, ARAMA_EN_UZUN, ARAMA_EN_COK_KELIME } from '../src/data/aramaFiltre.js'
import { YER_TUTUCU } from '../src/data/ekKurallari.js'

const yol = 'supabase/migrations/012_mesaj_arama.sql'
const ham = existsSync(yol) ? readFileSync(yol, 'utf8') : ''
const sql = ham.toLowerCase().replace(/\s+/g, ' ')
const fonk = (ad) => {
  const i = sql.search(new RegExp(`create (or replace )?function public\\.${ad}\\(`))
  if (i < 0) return ''
  const govdeBasi = sql.indexOf('$$', i)
  return sql.slice(i, sql.indexOf('$$;', govdeBasi + 2) + 3)
}
const ARAMA_IMZA = 'public.search_messages(text, uuid, text, text, timestamptz, timestamptz, boolean, bigint, integer)'

describe('012_mesaj_arama.sql', () => {
  it('dosya var', () => expect(existsSync(yol)).toBe(true))

  it('eklentiler extensions şemasında kurulur ve denetlenir', () => {
    expect(sql).toContain('create extension if not exists unaccent with schema extensions;')
    expect(sql).toContain('create extension if not exists pg_trgm with schema extensions;')
    // Başka şemadaysa taşınmaya çalışılır, olmazsa açık hata
    expect(sql).toContain("n.nspname = 'extensions'")
    expect(sql).toContain('alter extension')
    expect(sql).toContain('set schema extensions')
    expect(sql).toMatch(/raise exception '[^']*extensions[^']*'/)
  })

  it('yalnız ekleme: sütun/tablo silme, yeniden adlandırma, mevcut RPC değişimi yok', () => {
    expect(sql).not.toMatch(/drop column|rename column|rename to|drop table|alter column/)
    for (const ad of ['dm_list', 'unread_counts', 'open_dm', 'is_dm_participant', 'can_send_dm', 'is_member', 'edit_message', 'edit_dm_message']) {
      expect(fonk(ad), ad).toBe('')
    }
    expect(sql).not.toMatch(/create policy/)
  })

  it('arama_metni: Türkçe I/İ/ı → i, unaccent (şema adıyla), lower; immutable', () => {
    const f = fonk('arama_metni')
    expect(f).not.toBe('')
    expect(f).toContain('immutable')
    expect(f).toContain('security definer')
    expect(f).toContain('set search_path = public')
    // Ham metinde aranır: 'İ'.toLowerCase() birleşik nokta ekler
    expect(ham).toContain("translate(t, 'İIı', 'iii')")
    expect(f).toContain("extensions.unaccent('extensions.unaccent'::regdictionary")
    expect(f).toContain('lower(')
    // İndeks ifadesi INSERT eden kişinin yetkisiyle çalışır
    expect(sql).toContain('revoke all on function public.arama_metni(text) from public, anon;')
    expect(sql).toContain('grant execute on function public.arama_metni(text) to authenticated, service_role;')
  })

  it("trigram indeksleri kısmi: silinmişler ve DM'de metin dışı satırlar girmez", () => {
    expect(sql).toContain('create index if not exists messages_arama_idx on public.messages using gin (public.arama_metni(content) extensions.gin_trgm_ops) where deleted_at is null;')
    expect(sql).toContain("create index if not exists dm_messages_arama_idx on public.dm_messages using gin (public.arama_metni(content) extensions.gin_trgm_ops) where deleted_at is null and kind = 'text';")
  })

  it('search_messages: security definer, search_path, yalnız authenticated', () => {
    const f = fonk('search_messages')
    expect(f).not.toBe('')
    expect(f).toContain('security definer')
    expect(f).toContain('set search_path = public')
    expect(f).toContain('stable')
    expect(sql).toContain(`revoke all on function ${ARAMA_IMZA} from public, anon;`)
    expect(sql).toContain(`grant execute on function ${ARAMA_IMZA} to authenticated;`)
  })

  it('search_messages: giriş, uzunluk, kelime ve kısa sorgu kuralları istemciyle aynı', () => {
    const f = fonk('search_messages')
    expect(f).toContain("raise exception 'not_allowed'")
    expect(f).toContain(`char_length(coalesce(sorgu, '')) > ${ARAMA_EN_UZUN} then raise exception 'bad_query'`)
    expect(f).toContain(`cardinality(kelimeler) > ${ARAMA_EN_COK_KELIME} then raise exception 'bad_query'`)
    expect(f).toContain("raise exception 'too_short'")
    // sınır 1–50, varsayılan sayfa
    expect(f).toContain(`least(greatest(coalesce(sinir, ${ARAMA_SAYFA}), 1), 50)`)
  })

  it('search_messages: LIKE özel karakterleri kaçırılır, kelimeler VE ile', () => {
    const f = fonk('search_messages')
    expect(f).toContain("replace(replace(replace(k, '\\', '\\\\'), '%', '\\%'), '_', '\\_')")
    expect(f).toContain('public.arama_metni(m.content) ilike ana')
    expect(f).toContain('not exists (select 1 from unnest(desenler) d where not (public.arama_metni(m.content) ilike d))')
    // Yazısız ekli mesajın yer tutucusu metin aramasında eşleşmez
    expect(f).toContain(`m.content = '${YER_TUTUCU}'`.toLowerCase())
  })

  it('search_messages sunucu yolu: üyelik, yalnız metin kanalları, silinmemiş', () => {
    const f = fonk('search_messages')
    expect(f).toContain('from public.server_members sm where sm.server_id = sunucu and sm.user_id = ben')
    expect(f).toContain("c.server_id = sunucu and c.kind = 'text'")
    expect(f).toContain('m.channel_id = any (kanallar)')
    expect(f).toContain('m.deleted_at is null')
  })

  it('search_messages DM yolu: bire bir taraf + ŞU AN üye olunan gruplar; yalnız düz metin', () => {
    const f = fonk('search_messages')
    expect(f).toContain('not t.is_group and (t.user_a = ben or t.user_b = ben)')
    expect(f).toContain('from public.dm_members dm join public.dm_threads t on t.id = dm.thread_id where dm.user_id = ben and t.is_group')
    expect(f).toContain('m.thread_id = any (konusmalar)')
    expect(f).toContain("m.kind = 'text'")
  })

  it('search_messages: filtreler (yazar, tarih, ek, imleç) ve en yeniden eskiye', () => {
    const f = fonk('search_messages')
    expect(f).toContain('lower(p.username) = lower(')
    expect(f).toContain('m.author_id = yazar')
    expect(f).toContain('m.created_at < once_tarih')
    expect(f).toContain('m.created_at >= sonra_tarih')
    expect(f).toContain('m.attachment_count > 0')
    expect(f).toContain('m.id < oncesi')
    expect(f).toContain('order by m.id desc limit n')
  })
})
