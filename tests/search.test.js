// Mesaj arama veri katmanı (search.js): RPC adı/argümanları, sayfa (26 iste, 25 göster), hata metinleri
import { describe, it, expect, vi, beforeEach } from 'vitest'

const fake = vi.hoisted(() => ({}))
vi.mock('../src/lib/supabase.js', () => {
  fake.rpc = vi.fn(async () => ({ data: [], error: null }))
  return { supabase: { rpc: (...a) => fake.rpc(...a) } }
})

import { searchMessages, ARAMA_HATA_METINLERI } from '../src/data/search.js'
import { aramaCozumle, ARAMA_SAYFA } from '../src/data/aramaFiltre.js'

beforeEach(() => { fake.rpc.mockReset(); fake.rpc.mockResolvedValue({ data: [], error: null }) })

describe('searchMessages', () => {
  it('sunucu kapsamı: bütün filtreler RPC argümanına gider, 26 satır istenir', async () => {
    const c = aramaCozumle('oyun kimden:ayla kanal:genel ek:var önce:2026-11-05')
    await searchMessages({ tur: 'sunucu', id: 's1' }, c, { oncesi: 99 })
    expect(fake.rpc).toHaveBeenCalledWith('search_messages', {
      sorgu: 'oyun', sunucu: 's1', kanal_adi: 'genel', yazar_adi: 'ayla',
      once_tarih: c.once, sonra_tarih: null, ekli: true, oncesi: 99, sinir: ARAMA_SAYFA + 1,
    })
  })
  it('DM kapsamı: sunucu ve kanal boş', async () => {
    await searchMessages({ tur: 'dm' }, { metin: 'selam', kanal: 'genel', kimden: null, ek: false })
    const arg = fake.rpc.mock.calls[0][1]
    expect(arg.sunucu).toBe(null)
    expect(arg.kanal_adi).toBe(null)
    expect(arg.ekli).toBe(null)
    expect(arg.oncesi).toBe(null)
  })
  it('26. satır "daha var" demektir ve gösterilmez', async () => {
    fake.rpc.mockResolvedValue({ data: Array.from({ length: 26 }, (_, i) => ({ id: 100 - i })), error: null })
    const r = await searchMessages({ tur: 'dm' }, { metin: 'ab' })
    expect(r.sonuclar).toHaveLength(25)
    expect(r.dahaVar).toBe(true)
    fake.rpc.mockResolvedValue({ data: [{ id: 1 }], error: null })
    expect(await searchMessages({ tur: 'dm' }, { metin: 'ab' })).toEqual({ sonuclar: [{ id: 1 }], dahaVar: false })
  })
  it('hata kodları Türkçeye çevrilir', async () => {
    for (const kod of ['NOT_ALLOWED', 'TOO_SHORT', 'BAD_QUERY']) {
      fake.rpc.mockResolvedValue({ data: null, error: { message: kod } })
      await expect(searchMessages({ tur: 'dm' }, { metin: 'ab' })).rejects.toMatchObject({ code: kod, message: ARAMA_HATA_METINLERI[kod] })
    }
  })
})
