// "Yazıyor…" göstergesi (typing.js): private typing:<id> konusu, gönderim seyreltme, 5 sn düşme.
// Sahte Realtime + sahte saat: ağ ve gerçek bekleme yok.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createFakeRealtime } from './fakes/realtime.js'

const h = vi.hoisted(() => ({ rt: null }))
vi.mock('../src/lib/supabase.js', () => ({
  supabase: {
    channel: (...a) => h.rt.client.channel(...a),
    removeChannel: (...a) => h.rt.client.removeChannel(...a),
    realtime: { setAuth: (...a) => h.rt.client.realtime.setAuth(...a) },
  },
}))

import { joinTyping } from '../src/data/typing.js'

async function akit() { for (let i = 0; i < 20; i++) await Promise.resolve() }
const KANAL = '11111111-2222-3333-4444-555555555555'

beforeEach(() => {
  h.rt = createFakeRealtime()
  vi.useFakeTimers()
})
afterEach(() => { vi.useRealTimers() })

async function kur(ek = {}) {
  const degisimler = []
  const t = joinTyping(KANAL, { selfId: 'ben', selfName: 'Berk', onChange: (adlar, idler) => degisimler.push({ adlar, idler }), ...ek })
  await akit()
  const k = h.rt.channels[0]
  return { t, k, degisimler }
}

describe('joinTyping', () => {
  it('private typing:<id> konusuna, oturum anahtarını yeniledikten sonra katılır', async () => {
    const { k } = await kur()
    expect(k.topic).toBe(`typing:${KANAL}`)
    expect(k.params.config.private).toBe(true)
    expect(k.params.config.broadcast.self).toBe(false)
    expect(h.rt.log).toEqual(['setAuth', 'channel'])
    expect(k.state).toBe('joined')
  })

  it('yazarken en fazla 3 sn de bir "yaziyor" gönderir; bırakınca "birakti"', async () => {
    const { t, k } = await kur()
    t.typing()
    t.typing()
    vi.advanceTimersByTime(2999)
    t.typing()
    expect(k.sent.map((m) => m.event)).toEqual(['yaziyor'])
    expect(k.sent[0]).toEqual({ type: 'broadcast', event: 'yaziyor', payload: { user_id: 'ben', username: 'Berk' } })
    vi.advanceTimersByTime(1)
    t.typing()
    expect(k.sent.map((m) => m.event)).toEqual(['yaziyor', 'yaziyor'])
    t.stopped()
    t.stopped() // ikinci bırakma gönderilmez
    expect(k.sent.map((m) => m.event)).toEqual(['yaziyor', 'yaziyor', 'birakti'])
    t.typing() // bıraktıktan sonra hemen yeniden gönderilir
    expect(k.sent.map((m) => m.event)).toEqual(['yaziyor', 'yaziyor', 'birakti', 'yaziyor'])
  })

  it('hiç yazmadan stopped() bir şey göndermez', async () => {
    const { t, k } = await kur()
    t.stopped()
    expect(k.sent).toEqual([])
  })

  it('bağlanmadan önce gönderim yapılmaz', () => {
    const t = joinTyping(KANAL, { selfId: 'ben', selfName: 'Berk', onChange: () => {} })
    t.typing()
    expect(h.rt.channels).toHaveLength(0)
    t.leave()
  })

  it('başkasının sinyali adıyla görünür; 5 sn sonra kendiliğinden düşer, yeni sinyal süreyi uzatır', async () => {
    const { k, degisimler } = await kur()
    k.deliver('yaziyor', { user_id: 'u2', username: 'Ayla' })
    expect(degisimler.at(-1)).toEqual({ adlar: ['Ayla'], idler: ['u2'] })
    vi.advanceTimersByTime(4000)
    k.deliver('yaziyor', { user_id: 'u2', username: 'Ayla' })
    expect(degisimler).toHaveLength(1) // aynı kişi: yeniden bildirilmez
    vi.advanceTimersByTime(4999)
    expect(degisimler.at(-1).adlar).toEqual(['Ayla'])
    vi.advanceTimersByTime(1)
    expect(degisimler.at(-1)).toEqual({ adlar: [], idler: [] })
  })

  it('birden çok kişi sırayla listelenir; "birakti" ve clear() hemen kaldırır', async () => {
    const { t, k, degisimler } = await kur()
    k.deliver('yaziyor', { user_id: 'u2', username: 'Ayla' })
    k.deliver('yaziyor', { user_id: 'u3', username: 'Kerem' })
    expect(degisimler.at(-1).adlar).toEqual(['Ayla', 'Kerem'])
    k.deliver('birakti', { user_id: 'u2' })
    expect(degisimler.at(-1).adlar).toEqual(['Kerem'])
    t.clear('u3') // Kerem'in mesajı geldi
    expect(degisimler.at(-1).adlar).toEqual([])
  })

  it('kendi sinyalimiz gösterilmez', async () => {
    const { k, degisimler } = await kur()
    k.deliver('yaziyor', { user_id: 'ben', username: 'Berk' })
    expect(degisimler).toEqual([])
  })

  it('leave(): "birakti" gönderir, zamanlayıcıları temizler, kanalı kapatır; sonra hiçbir şey bildirilmez', async () => {
    const { t, k, degisimler } = await kur()
    t.typing()
    k.deliver('yaziyor', { user_id: 'u2', username: 'Ayla' })
    const once = degisimler.length
    await t.leave()
    expect(k.sent.map((m) => m.event)).toEqual(['yaziyor', 'birakti'])
    expect(h.rt.channels).toHaveLength(0)
    expect(vi.getTimerCount()).toBe(0)
    k.deliver('yaziyor', { user_id: 'u3', username: 'Kerem' })
    vi.advanceTimersByTime(10000)
    expect(degisimler).toHaveLength(once)
  })

  it('aynı kanala hızla yeniden katılınca eski kanalın kapanması beklenir (yeni nesne açılır)', async () => {
    const { t, k } = await kur()
    let ac
    h.rt.removeGate = new Promise((r) => { ac = r })
    t.leave()
    const t2 = joinTyping(KANAL, { selfId: 'ben', selfName: 'Berk', onChange: () => {} })
    await akit()
    expect(h.rt.created).toHaveLength(1) // eski kapanmadan yenisi açılmadı
    ac()
    await akit()
    expect(h.rt.created).toHaveLength(2)
    expect(h.rt.created[1]).not.toBe(k)
    expect(h.rt.created[1].state).toBe('joined')
    await t2.leave()
  })
})
