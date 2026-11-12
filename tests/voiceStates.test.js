// Sesli kanal durumu tablosu (voice_states) istemcisi: okuma, abonelik ve yazma kuyruğu.
// Supabase sahte nesneyle değiştirilir: tablo bellekte tutulur, her yazma 'ops' listesine düşer.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const fake = vi.hoisted(() => ({}))

vi.mock('../src/lib/supabase.js', () => {
  fake.rows = [] // voice_states satırları
  fake.ops = [] // yazma işlemleri: ['upsert', satır] | ['delete', { user_id, client_id }]
  fake.failNext = 0 // sonraki kaç yazma hata versin
  fake.failStatus = 0 // hata verirken HTTP durumu (0 = ağ hatası)
  fake.gate = null // yazmaları bekletmek için
  fake.channels = []
  fake.removed = []
  fake.from = vi.fn(() => {
    const filtre = {}
    let islem = 'select'
    let deger = null
    const zincir = {
      select: () => zincir,
      eq: (k, v) => { filtre[k] = v; return zincir },
      maybeSingle: () => zincir,
      upsert: (v) => { islem = 'upsert'; deger = v; return zincir },
      delete: () => { islem = 'delete'; return zincir },
      then: async (res, rej) => {
        try {
          if (islem !== 'select') {
            if (fake.gate) await fake.gate
            if (fake.failNext > 0) { fake.failNext--; return res({ data: null, error: { message: 'hata' }, status: fake.failStatus }) }
          }
          if (islem === 'upsert') {
            fake.ops.push(['upsert', deger])
            fake.rows = fake.rows.filter((r) => r.user_id !== deger.user_id).concat([{ ...deger }])
            return res({ data: null, error: null })
          }
          if (islem === 'delete') {
            fake.ops.push(['delete', { ...filtre }])
            fake.rows = fake.rows.filter((r) => !Object.entries(filtre).every(([k, v]) => r[k] === v))
            return res({ data: null, error: null })
          }
          const bulunan = fake.rows.filter((r) => Object.entries(filtre).every(([k, v]) => r[k] === v))
          return res({ data: 'user_id' in filtre ? (bulunan[0] ?? null) : bulunan, error: null })
        } catch (e) { rej?.(e) }
      },
    }
    return zincir
  })
  fake.channel = vi.fn((konu) => {
    const k = { konu, handlers: [], subCb: null }
    k.on = (_t, f, cb) => { k.handlers.push({ f, cb }); return k }
    k.subscribe = (cb) => { k.subCb = cb; return k }
    fake.channels.push(k)
    return k
  })
  return {
    supabase: {
      from: (...a) => fake.from(...a),
      channel: (...a) => fake.channel(...a),
      removeChannel: (k) => { fake.removed.push(k) },
    },
  }
})

import {
  upsertVoiceState, clearVoiceState, listVoiceStates, getMyVoiceState, subscribeVoiceStates,
  deleteStaleVoiceState, flushVoiceStates, resetVoiceStateWriter, voiceStateTiming, reassertVoiceState,
} from '../src/data/voiceStates.js'
import { CLIENT_ID } from '../src/presence/presence.js'

const satir = (userId, ek = {}) => ({
  user_id: userId, server_id: 's1', channel_id: 'v1', client_id: 'c-' + userId,
  muted: false, deafened: false, camera: false, screen: false, ...ek,
})
const durum = (ek = {}) => ({ userId: 'u1', serverId: 's1', channelId: 'v1', muted: false, deafened: false, camera: false, screen: false, ...ek })
async function akit() { for (let i = 0; i < 30; i++) await Promise.resolve() }

beforeEach(() => {
  vi.useFakeTimers()
  fake.rows = []
  fake.ops = []
  fake.failNext = 0
  fake.failStatus = 0
  fake.gate = null
  fake.channels = []
  fake.removed = []
  resetVoiceStateWriter()
})
afterEach(() => vi.useRealTimers())

describe('okuma', () => {
  it('listVoiceStates sunucunun satırlarını uygulama biçimine çevirir', async () => {
    fake.rows = [satir('u2', { muted: true, camera: true }), satir('u3', { server_id: 's2' })]
    const liste = await listVoiceStates('s1')
    expect(liste).toEqual([{
      userId: 'u2', serverId: 's1', channelId: 'v1', clientId: 'c-u2',
      muted: true, deafened: false, camera: true, screen: false,
    }])
  })

  it('getMyVoiceState kendi satırını (yoksa null) verir', async () => {
    fake.rows = [satir('u1', { channel_id: 'v9' })]
    expect((await getMyVoiceState('u1')).channelId).toBe('v9')
    expect(await getMyVoiceState('u5')).toBeNull()
  })
})

describe('yazma kuyruğu', () => {
  it('hızlı değişiklikler ~150 ms içinde TEK yazmada birleşir; en güncel durum gider', async () => {
    upsertVoiceState(durum())
    upsertVoiceState(durum({ muted: true }))
    upsertVoiceState(durum({ muted: true, deafened: true }))
    expect(fake.ops).toHaveLength(0) // henüz bekliyor
    vi.advanceTimersByTime(voiceStateTiming.coalesceMs)
    await akit()
    expect(fake.ops).toEqual([['upsert', {
      user_id: 'u1', server_id: 's1', channel_id: 'v1', client_id: CLIENT_ID,
      muted: true, deafened: true, camera: false, screen: false,
    }]])
  })

  it('yazmalar sırayla: biri sürerken gelen değişiklik o bitince gider', async () => {
    let ac
    fake.gate = new Promise((r) => { ac = r })
    upsertVoiceState(durum())
    vi.advanceTimersByTime(200)
    await akit()
    upsertVoiceState(durum({ camera: true }))
    vi.advanceTimersByTime(200)
    await akit()
    expect(fake.ops).toHaveLength(0) // ilk yazma hâlâ bekliyor; ikincisi başlamadı
    fake.gate = null
    ac()
    await akit()
    vi.advanceTimersByTime(200)
    await akit()
    expect(fake.ops.map(([o, r]) => [o, r.camera])).toEqual([['upsert', false], ['upsert', true]])
  })

  it('aynı durum tekrar yazılmaz', async () => {
    upsertVoiceState(durum())
    vi.advanceTimersByTime(200)
    await akit()
    upsertVoiceState(durum())
    vi.advanceTimersByTime(200)
    await akit()
    expect(fake.ops).toHaveLength(1)
  })

  it('Ayrıl: kendi satırını (bu pencerenin) siler', async () => {
    upsertVoiceState(durum())
    vi.advanceTimersByTime(200)
    await akit()
    clearVoiceState('u1')
    vi.advanceTimersByTime(200)
    await akit()
    expect(fake.ops.at(-1)).toEqual(['delete', { user_id: 'u1', client_id: CLIENT_ID }])
    expect(fake.rows).toEqual([])
  })

  it('katılıp hemen ayrılınca hiç yazmaz', async () => {
    upsertVoiceState(durum())
    clearVoiceState('u1')
    vi.advanceTimersByTime(500)
    await akit()
    expect(fake.ops).toEqual([])
  })

  it('başka kanala geçiş: önce eski satır silinir, sonra yenisi yazılır (eski sunucudakiler ayrıldığını görsün)', async () => {
    upsertVoiceState(durum())
    vi.advanceTimersByTime(200)
    await akit()
    clearVoiceState('u1')
    upsertVoiceState(durum({ serverId: 's2', channelId: 'w1' }))
    vi.advanceTimersByTime(200)
    await akit()
    expect(fake.ops.map(([o]) => o)).toEqual(['upsert', 'delete', 'upsert'])
    expect(fake.ops.at(-1)[1]).toMatchObject({ server_id: 's2', channel_id: 'w1' })
  })

  it('yazma başarısız olursa yeniden denenir (silme dahil)', async () => {
    upsertVoiceState(durum())
    vi.advanceTimersByTime(200)
    await akit()
    fake.failNext = 2
    clearVoiceState('u1')
    vi.advanceTimersByTime(200)
    await akit()
    expect(fake.rows).toHaveLength(1) // ilk deneme başarısız
    for (let i = 0; i < 3; i++) { vi.advanceTimersByTime(voiceStateTiming.retryMs); await akit() }
    expect(fake.rows).toEqual([])
  })

  it('kalıcı hata (RLS/FK, 4xx) yeniden denenmez: "ayrıldı" durumuna düşer', async () => {
    fake.failNext = 1
    fake.failStatus = 403
    upsertVoiceState(durum())
    vi.advanceTimersByTime(200)
    await akit()
    for (let i = 0; i < 5; i++) { vi.advanceTimersByTime(voiceStateTiming.retryMs); await akit() }
    expect(fake.ops).toEqual([]) // tekrar denenmedi
    let bitti = false
    flushVoiceStates().then(() => { bitti = true })
    await akit()
    expect(bitti).toBe(true) // kuyruk boş
    // sonraki değişiklik yine yazılır
    upsertVoiceState(durum({ muted: true }))
    vi.advanceTimersByTime(200)
    await akit()
    expect(fake.ops).toHaveLength(1)
  })

  it('401 (oturum anahtarı yenilenirken) geçici sayılır: yeniden denenir', async () => {
    fake.failNext = 1
    fake.failStatus = 401
    upsertVoiceState(durum())
    vi.advanceTimersByTime(200)
    await akit()
    expect(fake.rows).toHaveLength(0)
    vi.advanceTimersByTime(voiceStateTiming.retryMs)
    await akit()
    expect(fake.rows).toHaveLength(1)
  })

  it('geçici hata (ağ, 5xx, 429) yeniden denenir', async () => {
    fake.failNext = 2
    fake.failStatus = 503
    upsertVoiceState(durum())
    vi.advanceTimersByTime(200)
    await akit()
    for (let i = 0; i < 3; i++) { vi.advanceTimersByTime(voiceStateTiming.retryMs); await akit() }
    expect(fake.rows).toHaveLength(1)
  })

  it('satırımız başkası tarafından silinirse (reassertVoiceState) yeniden yazılır; ayrıldıysak yazılmaz', async () => {
    upsertVoiceState(durum())
    vi.advanceTimersByTime(200)
    await akit()
    fake.rows = [] // başka penceremiz "eski satır" sanıp sildi
    reassertVoiceState()
    vi.advanceTimersByTime(200)
    await akit()
    expect(fake.rows).toHaveLength(1)
    clearVoiceState('u1')
    vi.advanceTimersByTime(200)
    await akit()
    const once = fake.ops.length
    reassertVoiceState()
    vi.advanceTimersByTime(200)
    await akit()
    expect(fake.ops).toHaveLength(once)
  })

  it('clearVoiceState(.., { now: true }) beklemeden siler (sayfa kapanırken)', async () => {
    upsertVoiceState(durum())
    vi.advanceTimersByTime(200)
    await akit()
    clearVoiceState('u1', { now: true })
    await akit()
    expect(fake.ops.at(-1)[0]).toBe('delete')
  })

  it('flushVoiceStates kuyruk boşalınca biter', async () => {
    upsertVoiceState(durum({ muted: true }))
    let bitti = false
    flushVoiceStates().then(() => { bitti = true })
    await akit()
    expect(bitti).toBe(false)
    vi.advanceTimersByTime(200)
    await akit()
    expect(bitti).toBe(true)
    expect(fake.rows).toHaveLength(1)
  })

  it('deleteStaleVoiceState yalnız verilen pencerenin eski satırını siler', async () => {
    fake.rows = [satir('u1', { client_id: 'eski' })]
    await deleteStaleVoiceState('u1', 'baska')
    expect(fake.rows).toHaveLength(1)
    await deleteStaleVoiceState('u1', 'eski')
    expect(fake.rows).toEqual([])
  })
})

describe('abonelik', () => {
  const son = vi.fn()
  beforeEach(() => son.mockClear())
  const harita = () => son.mock.calls.at(-1)[0]
  // Kanalın postgres_changes geri çağrılarına olay gönder (filtreye uyanlara)
  function olay(k, eventType, yeni, eski) {
    for (const { f, cb } of k.handlers) {
      if (f.event !== '*' && f.event !== eventType) continue
      if (f.filter && eventType !== 'DELETE' && !f.filter.endsWith(`=eq.${yeni.server_id}`)) continue
      if (f.filter && eventType === 'DELETE') continue // Realtime: silme olayları filtrelenemez
      cb({ eventType, new: yeni ?? {}, old: eski ?? {} })
    }
  }

  it('benzersiz konuyla abone olur; bağlanınca listeyi yükleyip haritayı verir', async () => {
    fake.rows = [satir('u2', { muted: true })]
    subscribeVoiceStates('s1', son)
    subscribeVoiceStates('s1', () => {})
    expect(fake.channels[0].konu).not.toBe(fake.channels[1].konu)
    expect(fake.channels[0].konu.startsWith('voice_states:s1:')).toBe(true)
    const filtreli = fake.channels[0].handlers.find((h) => h.f.filter)
    expect(filtreli.f).toMatchObject({ event: '*', schema: 'public', table: 'voice_states', filter: 'server_id=eq.s1' })
    fake.channels[0].subCb('SUBSCRIBED')
    await akit()
    expect(harita().get('u2')).toMatchObject({ channelId: 'v1', muted: true })
  })

  it('ekleme/güncelleme/silme olayları haritayı günceller; silme yalnız user_id ile gelse de çalışır', async () => {
    subscribeVoiceStates('s1', son)
    const k = fake.channels[0]
    k.subCb('SUBSCRIBED')
    await akit()
    olay(k, 'INSERT', satir('u2'))
    expect(harita().get('u2').camera).toBe(false)
    olay(k, 'UPDATE', satir('u2', { camera: true }))
    expect(harita().get('u2').camera).toBe(true)
    olay(k, 'DELETE', null, { user_id: 'u2' })
    expect(harita().has('u2')).toBe(false)
  })

  it('silme olayında onDelete(userId) çağrılır', async () => {
    const onDelete = vi.fn()
    subscribeVoiceStates('s1', son, { onDelete })
    const k = fake.channels[0]
    k.subCb('SUBSCRIBED')
    await akit()
    olay(k, 'DELETE', null, { user_id: 'u1' })
    expect(onDelete).toHaveBeenCalledWith('u1')
  })

  it('yeniden bağlanınca liste yeniden yüklenir (kopukken kaçanlar)', async () => {
    subscribeVoiceStates('s1', son)
    const k = fake.channels[0]
    k.subCb('SUBSCRIBED')
    await akit()
    fake.rows = [satir('u3')]
    k.subCb('SUBSCRIBED')
    await akit()
    expect([...harita().keys()]).toEqual(['u3'])
  })

  it('kapatınca kanal bırakılır ve artık haber verilmez', async () => {
    const birak = subscribeVoiceStates('s1', son)
    const k = fake.channels[0]
    birak()
    expect(fake.removed).toContain(k)
    k.subCb('SUBSCRIBED')
    await akit()
    expect(son).not.toHaveBeenCalled()
  })
})
