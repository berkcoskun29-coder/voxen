// @vitest-environment jsdom
// Hata: Sağırlaştır / Sustur arka arkaya hızlıca açılıp kapanınca simge takılı kalıyordu.
// Sebep: her tıklama bir presence track() gönderiyordu; Supabase sunucusu kişi başı 30 sn'de en fazla
// 5 varlık çağrısına izin verir, aşılınca kanalı kapatır -> son durum hiç ulaşmaz, liste eski simgede kalır.
// Sahte realtime bu sınırı taklit eder (tests/fakes/realtime.js -> presenceLimit).
// Not: sesli durum artık varlıkta değil (voice_states tablosu); ama sınırlayıcı durum/yazı değişiklikleri
// için hâlâ geçerli. Buradaki voiceMuted vb. alanlar yalnızca sınırlayıcıyı denemek için gönderilen yüklerdir.
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

import { startPresence, resetPresenceLimiter } from '../src/presence/presence.js'

async function akit() { for (let i = 0; i < 60; i++) await Promise.resolve() }
const tercih = () => ({ dnd: false, statusText: '' })
// Uygulamanın her değişiklikte gönderdiği ses durumu (app.js -> sesDurumunuYayinla)
const ses = (muted, deafened) => ({ voiceMuted: muted, voiceDeafened: deafened, voiceCamera: false, voiceScreen: false })

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-01-01T12:00:00Z'))
  h.rt = createFakeRealtime()
  h.rt.presenceLimit = { max: 5, windowMs: 30000 } // Supabase varsayılanı
  resetPresenceLimiter() // gönderim geçmişi modül düzeyinde: testler birbirini etkilemesin
})
afterEach(() => vi.useRealTimers())

describe('hızlı susturma/sağırlaştırma (sunucu varlık sınırı)', () => {
  it('arka arkaya aç/kapa: sunucu kanalı kapatmaz ve SON durum sonunda sunucuya ulaşır', async () => {
    const p = startPresence('u1', tercih)
    await akit()
    p.update({ voiceChannelId: 'v1', ...ses(false, false) }) // sesli kanala katıldı
    await akit()
    // Birkaç milisaniye arayla: sustur, sağırlaştır, sağırlığı kaldır, susturmayı kaldır, sustur, kaldır
    const sira = [ses(true, false), ses(true, true), ses(true, false), ses(false, false), ses(true, false), ses(false, false)]
    for (const s of sira) {
      p.update(s)
      vi.advanceTimersByTime(5)
      await akit()
    }
    // Yeterince bekle (sınır penceresi dolsun)
    for (let i = 0; i < 70; i++) { vi.advanceTimersByTime(1000); await akit() }
    expect(h.rt.serverClosed).toBe(0) // sınır hiç aşılmadı
    expect(h.rt.serverState).toMatchObject({ voiceChannelId: 'v1', voiceMuted: false, voiceDeafened: false })
    await p.stop()
  })

  it('hızlı aç/kapa ardından Ayrıl: sonunda voiceChannelId null olarak ulaşır (kanalda takılı görünmez)', async () => {
    const p = startPresence('u1', tercih)
    await akit()
    p.update({ voiceChannelId: 'v1', ...ses(false, false) })
    await akit()
    // Canlı denemedeki gibi: ~10 ms arayla S D S D, sonra D S D
    for (const s of [ses(true, false), ses(true, true), ses(false, true), ses(false, false), ses(false, true), ses(true, true), ses(true, false)]) {
      p.update(s)
      vi.advanceTimersByTime(10)
      await akit()
    }
    p.update({ voiceChannelId: null, ...ses(false, false) }) // Ayrıl
    for (let i = 0; i < 70; i++) { vi.advanceTimersByTime(1000); await akit() }
    expect(h.rt.serverClosed).toBe(0)
    expect(h.rt.serverState).toMatchObject({ voiceChannelId: null, voiceMuted: false, voiceDeafened: false })
    await p.stop()
  })

  it('10 ms arayla gelen tıklamalar tek gönderimde birleşir; Ayrıl 1 sn içinde ulaşır', async () => {
    const p = startPresence('u1', tercih)
    await akit()
    p.update({ voiceChannelId: 'v1', ...ses(false, false) })
    vi.advanceTimersByTime(1000)
    await akit()
    const once = h.rt.created[0].tracked.length
    for (const s of [ses(true, false), ses(true, true), ses(false, true), ses(false, false)]) {
      p.update(s)
      vi.advanceTimersByTime(10)
      await akit()
    }
    p.update({ voiceChannelId: null, ...ses(false, false) }) // Ayrıl
    vi.advanceTimersByTime(1000)
    await akit()
    expect(h.rt.created[0].tracked.length - once).toBeLessThanOrEqual(2) // 5 değişiklik -> en fazla 2 gönderim
    expect(h.rt.serverState).toMatchObject({ voiceChannelId: null })
    await p.stop()
  })

  it('tek tıklama gecikmeden gider (sınır dolmamışsa beklemez)', async () => {
    const p = startPresence('u1', tercih)
    await akit()
    vi.advanceTimersByTime(1000)
    p.update(ses(true, false))
    await akit()
    expect(h.rt.serverState).toMatchObject({ voiceMuted: true })
    await p.stop()
  })

  it('sunucu kanalı yine de kapatırsa (CLOSED) kanal yeniden açılır ve son durum gönderilir', async () => {
    h.rt.presenceLimit = null
    const p = startPresence('u1', tercih)
    await akit()
    const ilk = h.rt.created[0]
    // Sunucu kanalı kapattı (ör. başka bir sebeple)
    ilk.state = 'closed'
    h.rt.channels = h.rt.channels.filter((x) => x !== ilk)
    ilk.cb('CLOSED')
    p.update(ses(true, true)) // kapalıyken değişti
    for (let i = 0; i < 40; i++) { vi.advanceTimersByTime(1000); await akit() }
    expect(h.rt.created).toHaveLength(2)
    expect(h.rt.created[1].state).toBe('joined')
    expect(h.rt.serverState).toMatchObject({ voiceMuted: true, voiceDeafened: true })
    await p.stop()
  })

  it('track() hata/zaman aşımı dönerse son durum yeniden denenir', async () => {
    h.rt.presenceLimit = null
    const p = startPresence('u1', tercih)
    await akit()
    const k = h.rt.created[0]
    const asil = k.track.bind(k)
    let ilkSefer = true
    k.track = (d) => {
      if (ilkSefer && d.voiceMuted) { ilkSefer = false; return Promise.resolve('timed out') } // kayboldu
      return asil(d)
    }
    p.update(ses(true, false))
    await akit()
    expect(h.rt.serverState.voiceMuted).toBeFalsy() // ilk deneme ulaşmadı
    for (let i = 0; i < 10; i++) { vi.advanceTimersByTime(1000); await akit() }
    expect(h.rt.serverState).toMatchObject({ voiceMuted: true })
    await p.stop()
  })
})

// İnceleme notları: yeniden açılışta artan bekleme, açmadan önce oturum anahtarı,
// pencereler (trackPresence örnekleri) arasında ORTAK gönderim geçmişi, stop() ile bekleyenlerin iptali.
describe('varlık kanalı yeniden açılışı ve ortak sınır', () => {
  // Sunucu kanalı kapatır (ör. sınır aşıldı): geri çağırmaya CLOSED gider
  function sunucuKapatsin(k) {
    k.state = 'closed'
    h.rt.channels = h.rt.channels.filter((x) => x !== k)
    k.cb('CLOSED')
  }
  // ms kadar ilerle (1 sn adımlarla, aradaki Promise'ler de bitsin)
  async function ilerle(ms) {
    for (let t = 0; t < ms; t += 500) { vi.advanceTimersByTime(500); await akit() }
  }

  it('art arda kapanışta bekleme artar: 3 → 6 → 12 → 30 → 30 sn', async () => {
    h.rt.presenceLimit = null
    const p = startPresence('u1', tercih)
    await akit()
    const beklemeler = []
    for (let i = 0; i < 5; i++) {
      const once = h.rt.created.length
      sunucuKapatsin(h.rt.created.at(-1))
      let gecen = 0
      while (h.rt.created.length === once && gecen < 60000) { await ilerle(500); gecen += 500 }
      beklemeler.push(gecen)
    }
    expect(beklemeler).toEqual([3000, 6000, 12000, 30000, 30000])
    await p.stop()
  })

  it('kanal bir süre sorunsuz bağlı kalınca bekleme yine 3 sn\'den başlar', async () => {
    h.rt.presenceLimit = null
    const p = startPresence('u1', tercih)
    await akit()
    sunucuKapatsin(h.rt.created.at(-1))
    await ilerle(3000) // 3 sn sonra açıldı
    sunucuKapatsin(h.rt.created.at(-1))
    await ilerle(6000) // 6 sn sonra açıldı
    expect(h.rt.created).toHaveLength(3)
    await ilerle(60000) // bir dakika sorunsuz bağlı
    sunucuKapatsin(h.rt.created.at(-1))
    await ilerle(3000)
    expect(h.rt.created).toHaveLength(4) // yine 3 sn
    await p.stop()
  })

  it('yeniden açmadan önce oturum anahtarı (setAuth) beklenir', async () => {
    h.rt.presenceLimit = null
    const p = startPresence('u1', tercih)
    await akit()
    let ac
    h.rt.client.realtime.setAuth = () => { h.rt.log.push('setAuth'); return new Promise((r) => { ac = r }) }
    h.rt.log = []
    sunucuKapatsin(h.rt.created[0])
    await ilerle(3000)
    expect(h.rt.log).toEqual(['setAuth']) // anahtar bekleniyor: kanal henüz açılmadı
    expect(h.rt.created).toHaveLength(1)
    ac()
    await akit()
    expect(h.rt.log).toEqual(['setAuth', 'channel'])
    expect(h.rt.created).toHaveLength(2)
    await p.stop()
  })

  it('çıkış/giriş: yeni örnek eski örneğin gönderimlerini sayar (sunucu kanalı kapatmaz)', async () => {
    const p1 = startPresence('u1', tercih)
    await akit()
    for (const s of [ses(true, false), ses(false, false), ses(true, false)]) {
      vi.advanceTimersByTime(300)
      p1.update(s)
      await akit()
    }
    expect(h.rt.created[0].tracked).toHaveLength(4) // 1 giriş + 3 değişiklik
    await p1.stop() // + 1 untrack = sunucuda 5 çağrı
    const p2 = startPresence('u1', tercih)
    await akit()
    expect(h.rt.created[1].tracked ?? []).toHaveLength(0) // sınır dolu: bekler
    await ilerle(31000)
    expect(h.rt.serverClosed).toBe(0)
    expect(h.rt.created[1].tracked.at(-1)).toMatchObject({ status: 'online' })
    await p2.stop()
  })

  it('stop(): bekleyen gönderim zamanlayıcısı iptal olur', async () => {
    const p = startPresence('u1', tercih)
    await akit()
    for (let i = 0; i < 6; i++) { vi.advanceTimersByTime(300); p.update(ses(i % 2 === 0, false)); await akit() }
    const k = h.rt.created[0]
    const once = k.tracked.length
    await p.stop()
    await ilerle(40000)
    expect(k.tracked).toHaveLength(once) // durduktan sonra hiçbir şey gönderilmedi
  })

  it('stop(): bekleyen yeniden açılış iptal olur', async () => {
    h.rt.presenceLimit = null
    const p = startPresence('u1', tercih)
    await akit()
    sunucuKapatsin(h.rt.created[0])
    await p.stop()
    await ilerle(40000)
    expect(h.rt.created).toHaveLength(1) // yeni kanal açılmadı
  })
})
