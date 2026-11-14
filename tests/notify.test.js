// @vitest-environment jsdom
// Bildirimler: karar (shouldNotify), metinler, birleştirme (5 sn), tarayıcı ve masaüstü gösterimi, tıklama.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const sahte = vi.hoisted(() => ({ gonderilen: [], eylem: null, birakildi: 0, pencere: [] }))
vi.mock('@tauri-apps/plugin-notification', () => ({
  sendNotification: (o) => sahte.gonderilen.push(o),
  onAction: async (cb) => { sahte.eylem = cb; return { unregister: async () => { sahte.birakildi++ } } },
}))
// Kanal bilgisi sorgusu (bahsetme başlığı için getChannel)
vi.mock('../src/lib/supabase.js', () => ({
  supabase: {
    from: (tablo) => {
      const z = { cagrilar: [] }
      for (const ad of ['select', 'eq', 'maybeSingle']) z[ad] = (...a) => { z.cagrilar.push([ad, ...a]); return z }
      z.then = (ok) => Promise.resolve(sahte.kanalSonuc).then(ok)
      sahte.sorgu = { tablo, z }
      return z
    },
  },
}))
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    unminimize: async () => sahte.pencere.push('unminimize'),
    show: async () => sahte.pencere.push('show'),
    setFocus: async () => sahte.pencere.push('setFocus'),
  }),
}))

import {
  shouldNotify, createNotifier, notifyTiming, bildirimBasligi, bildirimMetni, birlesikMetin,
  getNotifySettings, setNotifySettings, requestNotifyPermission, METIN_MAX,
  shouldNotifyCall, aramaBildirimMetni, bildirimIzni, getTraySettings, setTraySettings,
} from '../src/notify.js'
import { BEEPS } from '../src/voice/sounds.js'
import { getChannel } from '../src/data/channels.js'

const bosalt = async () => { for (let i = 0; i < 5; i++) await Promise.resolve() }

beforeEach(() => {
  localStorage.clear()
  sahte.gonderilen = []
  sahte.eylem = null
  sahte.birakildi = 0
  sahte.pencere = []
})
afterEach(() => {
  delete window.__TAURI_INTERNALS__
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('shouldNotify (Review Focus 3)', () => {
  const dm = { id: 1, thread_id: 't1', author_id: 'u2', content: 'selam', deleted_at: null }
  const anma = { id: 2, channel_id: 'c1', server_id: 's1', author_id: 'u2', content: '@berk bak', deleted_at: null }
  const temel = { selfId: 'u1', odakta: false, acikHedef: null, durum: 'online', sessizSunucular: new Set(), ayarlar: { masaustu: true, ses: true } }

  // [açıklama, değişiklikler, beklenen]
  const tablo = [
    ['DM: başkasından, pencere arkada', { msg: dm, tur: 'dm' }, true],
    ['DM: kendi mesajım (başka pencereden)', { msg: { ...dm, author_id: 'u1' }, tur: 'dm' }, false],
    ['DM: pencere odakta ve o konuşma açık', { msg: dm, tur: 'dm', odakta: true, acikHedef: 't1' }, false],
    ['DM: pencere odakta ama başka konuşma açık', { msg: dm, tur: 'dm', odakta: true, acikHedef: 't9' }, true],
    ['DM: pencere odakta, sunucu kanalı açık', { msg: dm, tur: 'dm', odakta: true, acikHedef: 'c1' }, true],
    ['DM: o konuşma açık ama pencere arkada', { msg: dm, tur: 'dm', odakta: false, acikHedef: 't1' }, true],
    ['DM: Rahatsız etmeyin', { msg: dm, tur: 'dm', durum: 'dnd' }, false],
    ['DM: boşta (idle) bildirim alır', { msg: dm, tur: 'dm', durum: 'idle' }, true],
    ['DM: masaüstü bildirimleri ayarı kapalı', { msg: dm, tur: 'dm', ayarlar: { masaustu: false, ses: true } }, false],
    ['DM: ses kapalı ama bildirim açık', { msg: dm, tur: 'dm', ayarlar: { masaustu: true, ses: false } }, true],
    ['DM: sessize alınamaz (sunucu sessizliği DM\'e etki etmez)', { msg: dm, tur: 'dm', sessizSunucular: new Set(['s1', 't1']) }, true],
    ['DM: silinmiş mesaj', { msg: { ...dm, deleted_at: '2026-11-13' }, tur: 'dm' }, false],
    ['bahsetme: pencere arkada', { msg: anma, tur: 'mention' }, true],
    ['bahsetme: kendi mesajım', { msg: { ...anma, author_id: 'u1' }, tur: 'mention' }, false],
    ['bahsetme: odakta ve o kanal açık', { msg: anma, tur: 'mention', odakta: true, acikHedef: 'c1' }, false],
    ['bahsetme: odakta, başka kanal açık', { msg: anma, tur: 'mention', odakta: true, acikHedef: 'c2' }, true],
    ['bahsetme: Rahatsız etmeyin', { msg: anma, tur: 'mention', durum: 'dnd' }, false],
    ['bahsetme: sunucu sessizde', { msg: anma, tur: 'mention', sessizSunucular: new Set(['s1']) }, false],
    ['bahsetme: başka sunucu sessizde', { msg: anma, tur: 'mention', sessizSunucular: new Set(['s2']) }, true],
    ['bahsetme: ayar kapalı', { msg: anma, tur: 'mention', ayarlar: { masaustu: false } }, false],
    ['tür yok', { msg: dm }, false],
    ['mesaj yok', { msg: null, tur: 'dm' }, false],
  ]
  it.each(tablo)('%s', (_ad, degisiklik, beklenen) => {
    expect(shouldNotify({ ...temel, ...degisiklik })).toBe(beklenen)
  })
})

describe('shouldNotifyCall (gelen arama, DM araması §2)', () => {
  const temel = { odakta: false, durum: 'online', ayarlar: { masaustu: true, ses: true } }
  const tablo = [
    ['pencere arkada', {}, true],
    ['pencere odakta (kart zaten görünüyor)', { odakta: true }, false],
    ['Rahatsız etmeyin', { durum: 'dnd' }, false],
    ['boşta (idle)', { durum: 'idle' }, true],
    ['masaüstü bildirimleri kapalı', { ayarlar: { masaustu: false, ses: true } }, false],
    ['bildirim sesi kapalı (bildirim yine gelir)', { ayarlar: { masaustu: true, ses: false } }, true],
  ]
  it.each(tablo)('%s', (_ad, degisiklik, beklenen) => {
    expect(shouldNotifyCall({ ...temel, ...degisiklik })).toBe(beklenen)
  })
})

describe('gelen arama bildirimi (bildirArama)', () => {
  function kur() {
    const gosterilen = []
    const sesCal = vi.fn()
    const odakla = vi.fn()
    const ac = vi.fn()
    const n = createNotifier({ ac, deps: { goster: (b) => { gosterilen.push(b); return true }, sesCal, odakla } })
    return { n, gosterilen, sesCal, odakla, ac }
  }

  it('"Ad" / "Ad seni arıyor", hedef { type: call, id }; bildirim sesi çalmaz (zil kartta)', () => {
    const { n, gosterilen, sesCal } = kur()
    n.bildirArama({ id: 'c1', ad: 'ali' })
    expect(gosterilen).toHaveLength(1)
    expect(gosterilen[0]).toMatchObject({ baslik: 'ali', metin: 'ali seni arıyor', hedef: { type: 'call', id: 'c1' }, etiket: 'call:c1' })
    expect(aramaBildirimMetni('ali')).toBe('ali seni arıyor')
    expect(sesCal).not.toHaveBeenCalled()
    n.destroy()
  })

  it('birleşmez, sayaç kurmaz; tıklayınca pencere öne gelir ve ac({ type: call, id }) çağrılır', () => {
    vi.useFakeTimers()
    const { n, gosterilen, odakla, ac } = kur()
    n.bildirArama({ id: 'c1', ad: 'ali' })
    n.bildirArama({ id: 'c2', ad: 'veli' })
    expect(gosterilen).toHaveLength(2)
    expect(vi.getTimerCount()).toBe(0)
    gosterilen[0].tikla(gosterilen[0].hedef)
    expect(odakla).toHaveBeenCalledTimes(1)
    expect(ac).toHaveBeenCalledWith({ type: 'call', id: 'c1' })
    n.destroy()
    n.bildirArama({ id: 'c3', ad: 'can' })
    expect(gosterilen).toHaveLength(2) // kapandıktan sonra gösterilmez
  })

  it('tarayıcıda Web Notification ile gösterilir (etiket call:<id>)', () => {
    const olusan = []
    class SahteBildirim { constructor(baslik, secenek) { this.baslik = baslik; this.secenek = secenek; this.close = vi.fn(); olusan.push(this) } }
    SahteBildirim.permission = 'granted'
    vi.stubGlobal('Notification', SahteBildirim)
    const ac = vi.fn()
    const n = createNotifier({ ac, deps: { sesCal: () => {}, odakla: () => {} } })
    n.bildirArama({ id: 'c1', ad: 'ali' })
    expect(olusan).toHaveLength(1)
    expect(olusan[0].baslik).toBe('ali')
    expect(olusan[0].secenek).toMatchObject({ body: 'ali seni arıyor', tag: 'call:c1' })
    olusan[0].onclick()
    expect(ac).toHaveBeenCalledWith({ type: 'call', id: 'c1' })
    n.destroy()
  })

  it('dönen kapat() Web Notification bildirimini kapatır; gösterilmediyse güvenle boş geçer', () => {
    const olusan = []
    class SahteBildirim { constructor(baslik, secenek) { this.baslik = baslik; this.secenek = secenek; this.close = vi.fn(); olusan.push(this) } }
    SahteBildirim.permission = 'granted'
    vi.stubGlobal('Notification', SahteBildirim)
    const n = createNotifier({ ac: vi.fn(), deps: { sesCal: () => {}, odakla: () => {} } })
    const kapat = n.bildirArama({ id: 'c1', ad: 'ali' })
    expect(olusan[0].close).not.toHaveBeenCalled()
    kapat()
    expect(olusan[0].close).toHaveBeenCalledTimes(1)
    SahteBildirim.permission = 'denied'
    expect(() => n.bildirArama({ id: 'c2', ad: 'ali' })()).not.toThrow()
    n.destroy()
    expect(() => n.bildirArama({ id: 'c3', ad: 'ali' })()).not.toThrow()
  })
})

describe('metinler', () => {
  it('başlık: DM için "Ad", bahsetme için "Ad (#kanal, Sunucu)"', () => {
    expect(bildirimBasligi({ tur: 'dm', ad: 'ali' })).toBe('ali')
    expect(bildirimBasligi({ tur: 'mention', ad: 'ali', kanal: 'genel', sunucu: 'Kanka' })).toBe('ali (#genel, Kanka)')
  })
  it('metin: ilk 100 karakter; emoji bölünmez', () => {
    expect(METIN_MAX).toBe(100)
    expect(bildirimMetni('a'.repeat(150))).toBe('a'.repeat(100))
    const emoji = '😀'.repeat(120)
    expect(Array.from(bildirimMetni(emoji))).toHaveLength(100)
    expect(bildirimMetni(emoji)).toBe('😀'.repeat(100))
    expect(bildirimMetni(null)).toBe('')
  })
  it('birleşik metin: "Ad: 3 yeni mesaj"', () => {
    expect(birlesikMetin('ali', 3)).toBe('ali: 3 yeni mesaj')
  })
  it('kısa bildirim sesi üretilir (dosya yok, sounds.js kalıbı)', () => {
    expect(BEEPS.bildirim.length).toBeGreaterThan(0)
  })
})

describe('cihazdaki ayarlar', () => {
  it('ikisi de varsayılan açık; değişiklik saklanır', () => {
    expect(getNotifySettings()).toEqual({ masaustu: true, ses: true })
    setNotifySettings({ ses: false })
    expect(getNotifySettings()).toEqual({ masaustu: true, ses: false })
    expect(JSON.parse(localStorage.getItem('voxen.bildirimler'))).toEqual({ masaustu: true, ses: false })
  })
  it('depolama kapalıysa bellekte kalır, hata vermez', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('kapalı') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('kapalı') })
    expect(() => setNotifySettings({ masaustu: false })).not.toThrow()
    expect(getNotifySettings().masaustu).toBe(false)
    vi.restoreAllMocks()
    setNotifySettings({ masaustu: true }) // sonraki testler için belleği geri al
  })
})

describe('birleştirme (5 sn)', () => {
  function kur() {
    const gosterilen = []
    const sesCal = vi.fn()
    const odakla = vi.fn()
    const ac = vi.fn()
    const n = createNotifier({ ac, deps: { goster: (b) => gosterilen.push(b), sesCal, odakla } })
    return { n, gosterilen, sesCal, odakla, ac }
  }
  const dmHedef = { type: 'dm', id: 't1' }

  it('ilk mesaj hemen gösterilir; 5 sn içindeki diğerleri tek özet bildirimde birleşir', () => {
    vi.useFakeTimers()
    const { n, gosterilen, sesCal } = kur()
    n.bildir({ hedef: dmHedef, ad: 'ali', baslik: 'ali', metin: 'm1' })
    expect(gosterilen.map((b) => b.metin)).toEqual(['m1'])
    expect(sesCal).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(2000)
    n.bildir({ hedef: dmHedef, ad: 'ali', baslik: 'ali', metin: 'm2' })
    vi.advanceTimersByTime(2000)
    n.bildir({ hedef: dmHedef, ad: 'ali', baslik: 'ali', metin: 'm3' })
    expect(gosterilen).toHaveLength(1) // süre içinde yeni bildirim yok
    vi.advanceTimersByTime(notifyTiming.birlesmeMs - 4000)
    expect(gosterilen.map((b) => b.metin)).toEqual(['m1', 'ali: 3 yeni mesaj'])
    expect(gosterilen[1].baslik).toBe('ali')
    expect(gosterilen[1].hedef).toEqual(dmHedef)
    expect(gosterilen[1].etiket).toBe(gosterilen[0].etiket) // tarayıcıda ilkinin yerine geçer
    expect(sesCal).toHaveBeenCalledTimes(1) // özet sessiz
    n.destroy()
  })

  it('tek mesajda özet gelmez; süre bitince yeni mesaj yeniden hemen gösterilir', () => {
    vi.useFakeTimers()
    const { n, gosterilen, sesCal } = kur()
    n.bildir({ hedef: dmHedef, ad: 'ali', baslik: 'ali', metin: 'm1' })
    vi.advanceTimersByTime(notifyTiming.birlesmeMs + 1)
    expect(gosterilen).toHaveLength(1)
    n.bildir({ hedef: dmHedef, ad: 'ali', baslik: 'ali', metin: 'm2' })
    expect(gosterilen.map((b) => b.metin)).toEqual(['m1', 'm2'])
    expect(sesCal).toHaveBeenCalledTimes(2)
    n.destroy()
  })

  it('farklı konuşmalar ayrı birleşir; DM ile aynı id\'li kanal karışmaz', () => {
    vi.useFakeTimers()
    const { n, gosterilen } = kur()
    n.bildir({ hedef: dmHedef, ad: 'ali', baslik: 'ali', metin: 'a1' })
    n.bildir({ hedef: { type: 'dm', id: 't2' }, ad: 'veli', baslik: 'veli', metin: 'v1' })
    n.bildir({ hedef: { type: 'mention', id: 't1', serverId: 's1' }, ad: 'can', baslik: 'can (#genel, S)', metin: 'c1' })
    n.bildir({ hedef: { type: 'dm', id: 't2' }, ad: 'veli', baslik: 'veli', metin: 'v2' })
    expect(gosterilen.map((b) => b.metin)).toEqual(['a1', 'v1', 'c1'])
    vi.advanceTimersByTime(notifyTiming.birlesmeMs)
    expect(gosterilen.map((b) => b.metin)).toEqual(['a1', 'v1', 'c1', 'veli: 2 yeni mesaj'])
    n.destroy()
  })

  it('ses ayarı kapalıysa ses çalmaz; bildirim yine gelir', () => {
    setNotifySettings({ ses: false })
    const { n, gosterilen, sesCal } = kur()
    n.bildir({ hedef: dmHedef, ad: 'ali', baslik: 'ali', metin: 'm1' })
    expect(gosterilen).toHaveLength(1)
    expect(sesCal).not.toHaveBeenCalled()
    n.destroy()
  })

  it('bildirim kimlikleri 32 bit tam sayı ve birbirinden farklı', () => {
    vi.useFakeTimers()
    const { n, gosterilen } = kur()
    n.bildir({ hedef: dmHedef, ad: 'ali', baslik: 'ali', metin: 'm1' })
    n.bildir({ hedef: { type: 'dm', id: 't2' }, ad: 'veli', baslik: 'veli', metin: 'v1' })
    const [a, b] = gosterilen.map((x) => x.id)
    expect(Number.isInteger(a) && a > 0 && a <= 2147483647).toBe(true)
    expect(a).not.toBe(b)
    n.destroy()
  })

  it('destroy bekleyen özetleri iptal eder; sonra gelen bildirim gösterilmez', () => {
    vi.useFakeTimers()
    const { n, gosterilen } = kur()
    n.bildir({ hedef: dmHedef, ad: 'ali', baslik: 'ali', metin: 'm1' })
    n.bildir({ hedef: dmHedef, ad: 'ali', baslik: 'ali', metin: 'm2' })
    n.destroy()
    vi.advanceTimersByTime(notifyTiming.birlesmeMs * 2)
    n.bildir({ hedef: { type: 'dm', id: 't2' }, ad: 'veli', baslik: 'veli', metin: 'v1' })
    expect(gosterilen.map((b) => b.metin)).toEqual(['m1'])
  })

  it('tıklama: pencere öne gelir ve doğru hedef açılır', () => {
    const { n, gosterilen, odakla, ac } = kur()
    const hedef = { type: 'mention', id: 'c1', serverId: 's1' }
    n.bildir({ hedef, ad: 'ali', baslik: 'ali (#genel, S)', metin: '@berk' })
    gosterilen[0].tikla(gosterilen[0].hedef)
    expect(odakla).toHaveBeenCalledTimes(1)
    expect(ac).toHaveBeenCalledWith(hedef)
    n.destroy()
  })
})

describe('tarayıcıda (Web Notification)', () => {
  function bildirimSahtesi(izin) {
    const olusan = []
    class SahteBildirim {
      constructor(baslik, secenek) { this.baslik = baslik; this.secenek = secenek; this.close = vi.fn(); olusan.push(this) }
    }
    SahteBildirim.permission = izin
    SahteBildirim.requestPermission = vi.fn(async () => 'granted')
    vi.stubGlobal('Notification', SahteBildirim)
    return { olusan, SahteBildirim }
  }

  it('izin verildiyse başlık, metin, logo ve konuşma etiketiyle gösterilir; tıklayınca hedef açılır', () => {
    const { olusan } = bildirimSahtesi('granted')
    const ac = vi.fn()
    const odak = vi.spyOn(window, 'focus').mockImplementation(() => {})
    const n = createNotifier({ ac, deps: { sesCal: () => {} } })
    n.bildir({ hedef: { type: 'dm', id: 't1' }, ad: 'ali', baslik: 'ali', metin: 'selam' })
    expect(olusan).toHaveLength(1)
    expect(olusan[0].baslik).toBe('ali')
    expect(olusan[0].secenek).toEqual({ body: 'selam', icon: '/favicon.svg', tag: 'dm:t1' })
    olusan[0].onclick()
    expect(olusan[0].close).toHaveBeenCalled()
    expect(odak).toHaveBeenCalled()
    expect(ac).toHaveBeenCalledWith({ type: 'dm', id: 't1' })
    n.destroy()
  })

  it('izin reddedildiyse sessizce gösterilmez', () => {
    const { olusan } = bildirimSahtesi('denied')
    const n = createNotifier({ ac: vi.fn(), deps: { sesCal: () => {} } })
    expect(() => n.bildir({ hedef: { type: 'dm', id: 't1' }, ad: 'ali', baslik: 'ali', metin: 'selam' })).not.toThrow()
    expect(olusan).toHaveLength(0)
    n.destroy()
  })

  it('izin yalnız henüz sorulmadıysa ve ayar açıksa istenir', async () => {
    const { SahteBildirim } = bildirimSahtesi('default')
    await requestNotifyPermission()
    expect(SahteBildirim.requestPermission).toHaveBeenCalledTimes(1)
    SahteBildirim.permission = 'denied'
    await requestNotifyPermission()
    expect(SahteBildirim.requestPermission).toHaveBeenCalledTimes(1)
    SahteBildirim.permission = 'default'
    setNotifySettings({ masaustu: false })
    await requestNotifyPermission()
    expect(SahteBildirim.requestPermission).toHaveBeenCalledTimes(1)
  })

  it('ses yalnız bildirim gösterildiyse çalar (izin yoksa ses de yok)', () => {
    const { SahteBildirim } = bildirimSahtesi('denied')
    const sesCal = vi.fn()
    const n = createNotifier({ ac: vi.fn(), deps: { sesCal } })
    n.bildir({ hedef: { type: 'dm', id: 't1' }, ad: 'ali', baslik: 'ali', metin: 'selam' })
    expect(sesCal).not.toHaveBeenCalled()
    SahteBildirim.permission = 'default'
    n.bildir({ hedef: { type: 'dm', id: 't2' }, ad: 'veli', baslik: 'veli', metin: 'selam' })
    expect(sesCal).not.toHaveBeenCalled()
    SahteBildirim.permission = 'granted'
    n.bildir({ hedef: { type: 'dm', id: 't3' }, ad: 'can', baslik: 'can', metin: 'selam' })
    expect(sesCal).toHaveBeenCalledTimes(1)
    n.destroy()
  })

  it('DM yolundan izin oturum başına bir kez sorulur; Ayarlar üzerinden (acik) yine sorulur', async () => {
    vi.resetModules() // modüldeki "soruldu" bayrağı temiz başlasın
    const taze = await import('../src/notify.js')
    const { SahteBildirim } = bildirimSahtesi('default')
    SahteBildirim.requestPermission = vi.fn(async () => 'default') // kişi soruyu kapatıp geçti
    await taze.requestNotifyPermission()
    await taze.requestNotifyPermission()
    expect(SahteBildirim.requestPermission).toHaveBeenCalledTimes(1)
    await taze.requestNotifyPermission({ acik: true })
    expect(SahteBildirim.requestPermission).toHaveBeenCalledTimes(2)
  })

  it('Notification desteklenmiyorsa hata vermez', async () => {
    vi.stubGlobal('Notification', undefined)
    await expect(requestNotifyPermission()).resolves.toBeUndefined()
    const n = createNotifier({ ac: vi.fn(), deps: { sesCal: () => {} } })
    expect(() => n.bildir({ hedef: { type: 'dm', id: 't1' }, ad: 'a', baslik: 'a', metin: 'b' })).not.toThrow()
    n.destroy()
  })
})

describe('masaüstünde (Tauri bildirim eklentisi)', () => {
  it('desktop.js üzerinden gönderilir; hedef bildirimin verisinde taşınır; tıklayınca pencere öne gelir ve hedef açılır', async () => {
    window.__TAURI_INTERNALS__ = {}
    const ac = vi.fn()
    const n = createNotifier({ ac, deps: { sesCal: () => {} } })
    // onAction dinleyicisi kurulsun (Windows'ta tıklama yalnız dinleyici varken bildirilir)
    await vi.waitFor(() => expect(typeof sahte.eylem).toBe('function'))
    n.bildir({ hedef: { type: 'mention', id: 'c1', serverId: 's1' }, ad: 'ali', baslik: 'ali (#genel, S)', metin: '@berk selam' })
    await vi.waitFor(() => expect(sahte.gonderilen).toHaveLength(1))
    const g = sahte.gonderilen[0]
    expect(g).toMatchObject({ title: 'ali (#genel, S)', body: '@berk selam', extra: { hedef: { type: 'mention', id: 'c1', serverId: 's1' } } })
    expect(Number.isInteger(g.id)).toBe(true)
    // Eklenti tıklamayı { actionId: 'tap', notification: { extra } } olarak bildirir
    sahte.eylem({ actionId: 'tap', inputValue: null, notification: { id: g.id, extra: g.extra } })
    await vi.waitFor(() => expect(sahte.pencere).toHaveLength(3))
    expect(sahte.pencere).toEqual(['unminimize', 'show', 'setFocus'])
    expect(ac).toHaveBeenCalledWith({ type: 'mention', id: 'c1', serverId: 's1' })
    // Verisi olmayan eylem yok sayılır
    sahte.eylem({ actionId: 'tap', notification: null })
    expect(ac).toHaveBeenCalledTimes(1)
    n.destroy()
    await vi.waitFor(() => expect(sahte.birakildi).toBe(1))
  })

  it('masaüstünde izin istenmez (Windows izin sormaz)', async () => {
    window.__TAURI_INTERNALS__ = {}
    const istek = vi.fn()
    vi.stubGlobal('Notification', Object.assign(function () {}, { permission: 'default', requestPermission: istek }))
    await requestNotifyPermission()
    expect(istek).not.toHaveBeenCalled()
  })
})

describe('getChannel (bahsetme başlığındaki kanal ve sunucu)', () => {
  it('tek kanalın adını ve sunucusunu getirir; yoksa null; hata fırlatır', async () => {
    sahte.kanalSonuc = { data: { id: 'c1', name: 'genel', server_id: 's1' }, error: null }
    expect(await getChannel('c1')).toEqual({ id: 'c1', name: 'genel', server_id: 's1' })
    expect(sahte.sorgu.tablo).toBe('channels')
    expect(sahte.sorgu.z.cagrilar).toEqual([['select', 'id, name, server_id'], ['eq', 'id', 'c1'], ['maybeSingle']])
    sahte.kanalSonuc = { data: null, error: null }
    expect(await getChannel('yok')).toBeNull()
    sahte.kanalSonuc = { data: null, error: { message: 'ağ' } }
    await expect(getChannel('c1')).rejects.toThrow('ağ')
  })
})

describe('v0.13.0: kanal mesajı (Tüm mesajlar), tepsi ayarları, izin durumu', () => {
  const kanalMsg = { id: 3, channel_id: 'c1', server_id: 's1', author_id: 'u2', content: 'selam', deleted_at: null }
  const temel = { selfId: 'u1', odakta: false, acikHedef: null, durum: 'online', sessizSunucular: new Set(), ayarlar: { masaustu: true } }

  it('tur "channel": kanal hedefi; açık ve odaktaysa yok; sessiz sunucuda yok; DND yok', () => {
    expect(shouldNotify({ ...temel, msg: kanalMsg, tur: 'channel' })).toBe(true)
    expect(shouldNotify({ ...temel, msg: kanalMsg, tur: 'channel', odakta: true, acikHedef: 'c1' })).toBe(false)
    expect(shouldNotify({ ...temel, msg: kanalMsg, tur: 'channel', sessizSunucular: new Set(['s1']) })).toBe(false)
    expect(shouldNotify({ ...temel, msg: kanalMsg, tur: 'channel', durum: 'dnd' })).toBe(false)
  })

  it('kanal mesajı başlığı bahsetmeyle aynı biçimde', () => {
    expect(bildirimBasligi({ tur: 'channel', ad: 'ayla', kanal: 'genel', sunucu: 'S' })).toBe('ayla (#genel, S)')
  })

  it('tepsi ayarları: varsayılan "kapatınca tepsiye küçült" açık, bilgi gösterilmedi', () => {
    expect(getTraySettings()).toEqual({ tepsiyeKucult: true, tepsiBilgisi: false })
    setTraySettings({ tepsiBilgisi: true })
    expect(getTraySettings()).toEqual({ tepsiyeKucult: true, tepsiBilgisi: true })
    setTraySettings({ tepsiyeKucult: false })
    expect(getTraySettings()).toEqual({ tepsiyeKucult: false, tepsiBilgisi: true })
    expect(getNotifySettings()).toEqual({ masaustu: true, ses: true }) // bildirim ayarları ayrı
  })

  it('bildirimIzni: masaüstünde ve API yokken "yok", tarayıcıda izin durumu', () => {
    vi.stubGlobal('Notification', { permission: 'denied' })
    expect(bildirimIzni()).toBe('denied')
    window.__TAURI_INTERNALS__ = {}
    expect(bildirimIzni()).toBe('yok')
    delete window.__TAURI_INTERNALS__
    vi.stubGlobal('Notification', undefined)
    expect(bildirimIzni()).toBe('yok')
  })
})

describe('düzeltme turu 1 (K1, K8): kanal bildirimlerinin birleşmesi', () => {
  afterEach(() => { vi.useRealTimers() })
  function kur() {
    const gosterilen = []
    const sesler = []
    const n = createNotifier({ ac: () => {}, deps: { goster: (b) => { gosterilen.push(b); return true }, sesCal: () => sesler.push(1), odakla: () => {} } })
    return { n, gosterilen, sesler }
  }
  const kanalHedef = { type: 'channel', id: 'c1', serverId: 's1' }

  it('kanal penceresi kayar: mesaj geldikçe uzar; özet kanalı anlatır; ses bir kez', () => {
    vi.useFakeTimers()
    const { n, gosterilen, sesler } = kur()
    const ozet = { baslik: 'S', ad: '#genel' }
    n.bildir({ hedef: kanalHedef, ad: 'ayla', baslik: 'ayla (#genel, S)', metin: 'a', ozet })
    for (let i = 0; i < 4; i++) {
      vi.advanceTimersByTime(4000)
      n.bildir({ hedef: kanalHedef, ad: i % 2 ? 'kerem' : 'ayla', baslik: 'x', metin: 'b', ozet })
    }
    expect(gosterilen).toHaveLength(1) // 16 sn geçti, pencere hâlâ açık
    vi.advanceTimersByTime(5000)
    expect(gosterilen.map((g) => [g.baslik, g.metin])).toEqual([['ayla (#genel, S)', 'a'], ['S', '#genel: 5 yeni mesaj']])
    expect(sesler).toHaveLength(1)
  })

  it('kayan pencere en fazla 30 sn uzar', () => {
    vi.useFakeTimers()
    const { n, gosterilen } = kur()
    n.bildir({ hedef: kanalHedef, ad: 'a', baslik: 'a', metin: 'a' })
    for (let i = 0; i < 10; i++) { vi.advanceTimersByTime(4000); n.bildir({ hedef: kanalHedef, ad: 'a', baslik: 'a', metin: 'a' }) }
    // 28. sn'deki mesaj son uzatma (33. sn'ye); 32. sn'deki sayılır ama uzatmaz; 36. sn'deki yeni pencere açar
    expect(gosterilen.map((g) => g.metin)).toEqual(['a', 'a: 9 yeni mesaj', 'a'])
  })

  it('kanal penceresi açıkken gelen anma hemen ve kendi metniyle gösterilir', () => {
    vi.useFakeTimers()
    const { n, gosterilen } = kur()
    n.bildir({ hedef: kanalHedef, ad: 'ayla', baslik: 'ayla (#genel, S)', metin: 'selam' })
    n.bildir({ hedef: { type: 'mention', id: 'c1', serverId: 's1' }, ad: 'kerem', baslik: 'kerem (#genel, S)', metin: '@berk bak' })
    expect(gosterilen.map((g) => g.metin)).toEqual(['selam', '@berk bak'])
  })

  it('K8: "Bildirimlere izin ver" (acik) masaüstü anahtarı kapalıyken de izin sorar', async () => {
    const izin = { permission: 'default', requestPermission: vi.fn(async () => 'granted') }
    vi.stubGlobal('Notification', izin)
    setNotifySettings({ masaustu: false })
    await requestNotifyPermission()
    expect(izin.requestPermission).not.toHaveBeenCalled()
    await requestNotifyPermission({ acik: true })
    expect(izin.requestPermission).toHaveBeenCalledTimes(1)
  })
})
