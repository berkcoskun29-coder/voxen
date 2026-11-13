// @vitest-environment jsdom
// DM araması (Görev 3): 📞 düğmesi, arama paneli ve arayanın akışı (zaman aşımı, kopma, canlılık).
// Akış sahte bağımlılıklarla ve sahte saatle sürülür; uygulama bağlantısı tests/app-chat.test.js'te.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

vi.mock('../src/lib/supabase.js', () => ({ supabase: { rpc: vi.fn() } }))

import {
  createCallFlow, mountCallPanel, createCallButton, aramaGorunumu, sureYazisi, aramaHataMetni,
  callTiming, ARAMA_METINLERI,
} from '../src/ui/callPanel.js'

const ben = { id: 'u1', username: 'berk', color: '#5b7cfa', avatar_url: null }
const ayla = { id: 'u2', username: 'ayla', color: '#e05b5b', avatar_url: null }
const thread = { id: 't1', other: ayla, canSend: true }

async function akit() { for (let i = 0; i < 10; i++) await Promise.resolve() }

// Sahte ses oturumu: durum, bağlı eşler ve olaylar test elle sürülür
function sahteOturum() {
  const dinle = { change: new Set(), tracks: new Set(), speaking: new Set() }
  const st = { status: 'connecting', muted: false, deafened: false, listenOnly: false, speaking: new Set() }
  let bagli = []
  let karsi = null
  return {
    st,
    dinle,
    getState: () => st,
    on(ad, cb) { dinle[ad].add(cb); return () => dinle[ad].delete(cb) },
    connectedPeers: () => bagli,
    getPeerState: () => karsi,
    // Eş bağlandı / düştü (oturumun 'tracks' olayı gibi)
    esler(ids, status = 'connected') { bagli = ids; st.status = status; for (const cb of dinle.tracks) cb() },
    karsiDurumu(d) { karsi = d; for (const cb of dinle.change) cb(st) },
    dinleyiciSayisi: () => dinle.change.size + dinle.tracks.size + dinle.speaking.size,
  }
}

function akisKur() {
  const k = { toasts: [], beeps: [], ends: [], enters: [], exits: [], tonlar: 0, tonDurdu: 0, cizim: 0, oncesi: 0, oturum: null }
  k.startCall = vi.fn(async () => ({ id: 'c1', status: 'ringing' }))
  k.pingCall = vi.fn(async () => true)
  k.getCallStatus = vi.fn(async () => ({ status: 'ringing', reason: null }))
  k.akis = createCallFlow({
    getCallStatus: (...a) => k.getCallStatus(...a),
    startCall: (...a) => k.startCall(...a),
    endCall: async (id, reason) => { k.ends.push([id, reason]) },
    pingCall: (...a) => k.pingCall(...a),
    enter: (call) => { k.enters.push(call.id); k.oturum = sahteOturum(); return k.oturum },
    exit: (reason) => { k.exits.push(reason); return Promise.resolve() },
    beforeStart: () => { k.oncesi++ },
    toast: (m, t) => k.toasts.push([m, t]),
    beep: (ad) => k.beeps.push(ad),
    startTone: () => { k.tonlar++; return () => { k.tonDurdu++ } },
    onChange: () => { k.cizim++ },
  })
  return k
}

const hata = (code, message = 'x') => Object.assign(new Error(message), { code })

beforeEach(() => {
  vi.useFakeTimers()
  document.body.innerHTML = ''
})
afterEach(() => vi.useRealTimers())

describe('yardımcılar', () => {
  it('süre yazısı: "00:42", saat geçince "s:dd:ss"', () => {
    expect(sureYazisi(0)).toBe('00:00')
    expect(sureYazisi(42_000)).toBe('00:42')
    expect(sureYazisi(754_900)).toBe('12:34')
    expect(sureYazisi(3_723_000)).toBe('1:02:03')
  })

  it('başlatma hataları: BUSY adla, engel kodları arama cümlesiyle, diğerleri kendi metniyle', () => {
    expect(aramaHataMetni(hata('BUSY'), 'ayla')).toBe('ayla şu an başka bir aramada.')
    expect(aramaHataMetni(hata('ALREADY_IN_CALL', 'Zaten bir aramadasın.'), 'ayla')).toBe('Zaten bir aramadasın.')
    expect(aramaHataMetni(hata('NOT_ALLOWED', 'Bu kişiye mesaj gönderemezsin.'), 'ayla')).toBe('Bu kişiyi şu an arayamazsın.')
    expect(aramaHataMetni(hata('BLOCKED_DM', 'Bu kişiye mesaj gönderemezsin.'), 'ayla')).toBe('Bu kişiyi şu an arayamazsın.')
    expect(aramaHataMetni(hata(null, 'Bir sorun oluştu.'), 'ayla')).toBe('Bir sorun oluştu.')
  })
})

describe('📞 düğmesi', () => {
  it('etkin: "Sesli arama başlat"; kutu kapalıyken ve aramadayken pasif (tıklama boşa gider)', () => {
    const tik = vi.fn()
    const { button, update } = createCallButton({ onClick: tik })
    expect(button.getAttribute('aria-label')).toBe('Sesli arama başlat')
    expect(button.dataset.tip).toBe('Sesli arama başlat')
    button.click()
    expect(tik).toHaveBeenCalledTimes(1)

    update({ canSend: false })
    expect(button.getAttribute('aria-disabled')).toBe('true')
    expect(button.dataset.tip).toBe('Bu kişiyi şu an arayamazsın.')
    button.click()
    expect(tik).toHaveBeenCalledTimes(1)

    update({ canSend: true, inCall: true, withPeer: true })
    expect(button.getAttribute('aria-label')).toBe('Aramadasın')
    expect(button.dataset.tip).toBe('Aramadasın')
    button.click()
    expect(tik).toHaveBeenCalledTimes(1)

    // Başka bir kişiyle aramadayken: ad "Sesli arama başlat" kalır, pasif, baloncukta "Zaten bir aramadasın."
    update({ canSend: true, inCall: true, withPeer: false })
    expect(button.getAttribute('aria-label')).toBe('Sesli arama başlat')
    expect(button.dataset.tip).toBe('Zaten bir aramadasın.')
    expect(button.getAttribute('aria-disabled')).toBe('true')
    button.click()
    expect(tik).toHaveBeenCalledTimes(1)

    update({ canSend: true, inCall: false })
    expect(button.hasAttribute('aria-disabled')).toBe(false)
    button.click()
    expect(tik).toHaveBeenCalledTimes(2)
  })
})

describe('arama paneli', () => {
  it('Kamera: tıklayınca onToggleCamera; açıkken basılı ve "Kamerayı kapat"; bağlanırken pasif; hata durum satırında', () => {
    const host = document.createElement('div')
    const h = { onToggleCamera: vi.fn(), onToggleScreen: vi.fn() }
    const p = mountCallPanel(host, h)
    const g = {
      faz: 'konusma', self: ben, other: ayla, sure: '00:01', baglanti: null, konusanlar: new Set(),
      ben: { muted: false, deafened: false, camera: false, screen: false, status: 'connecting' }, karsi: null,
    }
    p.ciz(g)
    const kamera = host.querySelector('[data-ad="Kamera"]')
    expect(kamera.getAttribute('aria-disabled')).toBe('true')
    expect(kamera.title).toBe('Bağlanırken kullanılamaz')
    kamera.click()
    expect(h.onToggleCamera).not.toHaveBeenCalled()
    // Bağlanınca etkinleşir (aynı düğüm yerinde kalır)
    p.ciz({ ...g, ben: { ...g.ben, status: 'connected' } })
    expect(host.querySelector('[data-ad="Kamera"]')).toBe(kamera)
    expect(kamera.hasAttribute('aria-disabled')).toBe(false)
    expect(kamera.classList.contains('unavailable')).toBe(false)
    kamera.click()
    expect(h.onToggleCamera).toHaveBeenCalledTimes(1)
    p.ciz({ ...g, ben: { ...g.ben, status: 'connected', camera: true }, hata: 'Kamera açılamadı' })
    expect(kamera.getAttribute('aria-pressed')).toBe('true')
    expect(kamera.getAttribute('aria-label')).toBe('Kamerayı kapat')
    expect(kamera.classList.contains('active')).toBe(true)
    const durum = host.querySelector('.call-status')
    expect(durum.hidden).toBe(false)
    expect(durum.textContent).toBe('Kamera açılamadı')
    // Bağlantı yazısı hatadan önce gelir
    p.ciz({ ...g, ben: { ...g.ben, status: 'connected' }, hata: 'Kamera açılamadı', baglanti: ARAMA_METINLERI.koptu })
    expect(durum.textContent).toBe(ARAMA_METINLERI.koptu)
  })

  it('Ekran: destekleniyorsa düğme var, tıklayınca onToggleScreen; açıkken "Paylaşımı durdur"', () => {
    const eski = navigator.mediaDevices
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getDisplayMedia: () => {} } })
    try {
      const host = document.createElement('div')
      const h = { onToggleScreen: vi.fn() }
      const p = mountCallPanel(host, h)
      const g = {
        faz: 'konusma', self: ben, other: ayla, sure: '00:01', baglanti: null, konusanlar: new Set(),
        ben: { muted: false, deafened: false, camera: false, screen: false, status: 'connected' }, karsi: null,
      }
      p.ciz(g)
      const ekran = host.querySelector('[data-ad="Ekran"]')
      expect(ekran.getAttribute('aria-label')).toBe('Ekranı paylaş')
      ekran.click()
      expect(h.onToggleScreen).toHaveBeenCalledTimes(1)
      p.ciz({ ...g, ben: { ...g.ben, screen: true } })
      expect(ekran.getAttribute('aria-label')).toBe('Paylaşımı durdur')
      expect(ekran.getAttribute('aria-pressed')).toBe('true')
    } finally {
      Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: eski })
    }
  })

  it('"Aranıyor…": karşının avatarı nabız sınıfıyla, adı, tek düğme İptal (kırmızı)', () => {
    const host = document.createElement('div')
    const onCancel = vi.fn()
    const p = mountCallPanel(host, { onCancel })
    expect(host.hidden).toBe(true)
    p.ciz({ faz: 'araniyor', self: ben, other: ayla })
    expect(host.hidden).toBe(false)
    expect(host.querySelectorAll('.call-avatar-wrap')).toHaveLength(1)
    expect(host.querySelector('.call-avatar-wrap').classList.contains('nabiz')).toBe(true)
    expect(host.querySelector('.call-name').textContent).toBe('ayla')
    expect(host.querySelector('.call-status').textContent).toBe('Aranıyor…')
    const dugmeler = host.querySelectorAll('button')
    expect([...dugmeler].map((b) => b.textContent)).toEqual(['İptal'])
    expect(dugmeler[0].classList.contains('danger')).toBe(true)
    dugmeler[0].click()
    expect(onCancel).toHaveBeenCalled()
    p.ciz(null)
    expect(host.hidden).toBe(true)
    expect(host.children).toHaveLength(0)
  })

  it('konuşma: iki avatar, konuşan halkası, süre, karşının susturma simgesi, Sustur/Sağırlaştır/Kapat', () => {
    const host = document.createElement('div')
    document.body.appendChild(host) // odak denetimi için belgede olmalı
    const h = { onHangup: vi.fn(), onToggleMute: vi.fn(), onToggleDeafen: vi.fn() }
    const p = mountCallPanel(host, h)
    const g = {
      faz: 'konusma', self: ben, other: ayla, sure: '00:42', baglanti: null,
      konusanlar: new Set(['u2']), ben: { muted: false, deafened: false }, karsi: { muted: true, deafened: false },
    }
    p.ciz(g)
    const av = [...host.querySelectorAll('.call-avatar-wrap')]
    expect(av.map((a) => a.dataset.id)).toEqual(['u1', 'u2'])
    expect(av.map((a) => a.classList.contains('speaking'))).toEqual([false, true])
    expect(av[1].querySelector('.call-avatar-state [data-state="muted"]')).not.toBeNull()
    expect(av[0].querySelector('.call-avatar-state')).toBeNull()
    expect(host.querySelector('.call-timer').textContent).toBe('00:42')
    expect(host.querySelector('.call-status').hidden).toBe(true)
    const ad = (x) => host.querySelector(`[data-ad="${x}"]`)
    expect([...host.querySelectorAll('.call-buttons button')].map((b) => b.getAttribute('aria-label'))).toEqual(['Sustur', 'Sağırlaştır', 'Kamerayı aç', 'Kapat'])
    expect(ad('Sustur').getAttribute('aria-pressed')).toBe('false')
    ad('Sustur').click()
    ad('Sağırlaştır').click()
    ad('Kapat').click()
    expect(h.onToggleMute).toHaveBeenCalled()
    expect(h.onToggleDeafen).toHaveBeenCalled()
    expect(h.onHangup).toHaveBeenCalled()

    // Yeniden çizim düğmeleri yerinde bırakır (klavye odağı her saniye kaybolmaz)
    const sustur = ad('Sustur')
    sustur.focus()
    p.ciz({ ...g, sure: '00:43', ben: { muted: true, deafened: false }, karsi: { muted: false, deafened: true }, baglanti: ARAMA_METINLERI.koptu })
    expect(ad('Sustur')).toBe(sustur)
    expect(document.activeElement).toBe(sustur)
    expect(sustur.getAttribute('aria-pressed')).toBe('true')
    expect(host.querySelector('.call-timer').textContent).toBe('00:43')
    expect(host.querySelector('.call-status').textContent).toBe('Bağlantı koptu, yeniden deneniyor…')
    expect(host.querySelector('.call-avatar-wrap[data-id="u2"] [data-state="deafened"]')).not.toBeNull()
  })

  it('saniyelik çizimde avatar düğümleri yeniden kurulmaz; halka ve köşe simgesi yerinde değişir', () => {
    const host = document.createElement('div')
    const p = mountCallPanel(host, {})
    const g = {
      faz: 'konusma', self: ben, other: ayla, sure: '00:01', baglanti: null,
      konusanlar: new Set(), ben: { muted: false, deafened: false }, karsi: null,
    }
    p.ciz(g)
    const [avBen, avKarsi] = host.querySelectorAll('.call-avatar-wrap')
    for (let i = 2; i < 5; i++) p.ciz({ ...g, sure: `00:0${i}` })
    p.ciz({ ...g, konusanlar: new Set(['u2']), karsi: { muted: true, deafened: false } })
    const sonra = host.querySelectorAll('.call-avatar-wrap')
    expect(sonra[0]).toBe(avBen)
    expect(sonra[1]).toBe(avKarsi)
    expect(avKarsi.classList.contains('speaking')).toBe(true)
    const kose = avKarsi.querySelector('.call-avatar-state')
    expect(kose.querySelector('[data-state="muted"]')).not.toBeNull()
    p.ciz({ ...g, sure: '00:06', konusanlar: new Set(['u2']), karsi: { muted: true, deafened: false } })
    expect(avKarsi.querySelector('.call-avatar-state')).toBe(kose) // durum aynı: simge de yerinde
    p.ciz({ ...g, karsi: null })
    expect(avKarsi.classList.contains('speaking')).toBe(false)
    expect(avKarsi.querySelector('.call-avatar-state')).toBeNull()
  })

  it('akışla: süre sayacı ilerlerken avatar düğümü aynı kalır', async () => {
    const k = akisKur()
    k.startCall = vi.fn(async () => ({ id: 'c1', status: 'active' }))
    const host = document.createElement('div')
    const p = mountCallPanel(host, {})
    k.akis.baslat(thread)
    await akit()
    p.ciz(aramaGorunumu(k.akis.bilgi(), ben))
    const av = host.querySelector('.call-avatar-wrap[data-id="u2"]')
    vi.advanceTimersByTime(3000)
    p.ciz(aramaGorunumu(k.akis.bilgi(), ben))
    expect(host.querySelector('.call-timer').textContent).toBe('00:03')
    expect(host.querySelector('.call-avatar-wrap[data-id="u2"]')).toBe(av)
  })

  it('hareket azaltma tercihinde nabız animasyonu kapanır', () => {
    const css = readFileSync(join(process.cwd(), 'src/styles/theme.css'), 'utf8')
    expect(css).toMatch(/\.call-avatar-wrap\.nabiz\s*\{[^}]*animation:/)
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{[^@]*\.call-avatar-wrap\.nabiz\s*\{\s*animation:\s*none/)
  })
})

describe('arayan: "Aranıyor…"', () => {
  it('📞 -> startCall; önce sesli kanaldan çıkış, bekleme tonu; 30 sn sonra timeout + "Cevap yok."', async () => {
    const k = akisKur()
    k.akis.baslat(thread)
    expect(k.akis.bilgi().faz).toBe('baslatiliyor')
    await akit()
    expect(k.startCall).toHaveBeenCalledWith('t1')
    expect(k.oncesi).toBe(1)
    expect(k.akis.bilgi()).toMatchObject({ faz: 'araniyor', call: { id: 'c1' } })
    expect(k.tonlar).toBe(1)
    expect(k.enters).toEqual([]) // arayan sese ancak cevap gelince girer
    vi.advanceTimersByTime(callTiming.ringMs - 1)
    expect(k.ends).toEqual([])
    vi.advanceTimersByTime(1)
    await akit()
    expect(k.ends).toEqual([['c1', 'timeout']])
    expect(k.toasts).toEqual([['Cevap yok.', 'bilgi']])
    expect(k.beeps).toEqual(['leave'])
    expect(k.tonDurdu).toBe(1)
    expect(k.akis.bilgi()).toBeNull()
    expect(vi.getTimerCount()).toBe(0)
  })

  it("30 sn dolunca önce durum okunur: 'active' olayı kaçtıysa arayan konuşmaya geçer, timeout gönderilmez", async () => {
    const k = akisKur()
    k.getCallStatus = vi.fn(async () => ({ status: 'active', reason: null }))
    k.akis.baslat(thread)
    await akit()
    vi.advanceTimersByTime(callTiming.ringMs)
    await akit()
    expect(k.getCallStatus).toHaveBeenCalledWith('c1')
    expect(k.enters).toEqual(['c1'])
    expect(k.ends).toEqual([])
    expect(k.toasts).toEqual([])
    expect(k.tonDurdu).toBe(1)
    expect(k.akis.bilgi().faz).toBe('konusma')
  })

  it('30 sn dolunca durum ended ise nedenine göre kapanır (decline -> reddetti), timeout gönderilmez', async () => {
    const k = akisKur()
    k.getCallStatus = vi.fn(async () => ({ status: 'ended', reason: 'decline' }))
    k.akis.baslat(thread)
    await akit()
    vi.advanceTimersByTime(callTiming.ringMs)
    await akit()
    expect(k.ends).toEqual([])
    expect(k.toasts).toEqual([['ayla aramayı reddetti.', 'bilgi']])
    expect(k.akis.bilgi()).toBeNull()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('30 sn dolunca durum okunamazsa yine timeout gönderilir', async () => {
    const k = akisKur()
    k.getCallStatus = vi.fn(async () => { throw new Error('ağ') })
    k.akis.baslat(thread)
    await akit()
    vi.advanceTimersByTime(callTiming.ringMs)
    await akit()
    expect(k.ends).toEqual([['c1', 'timeout']])
    expect(k.toasts).toEqual([['Cevap yok.', 'bilgi']])
  })

  it('yenidenDenetle (user: kanalı yeniden bağlandı): active ise konuşmaya geçer; ringing ise bir şey olmaz', async () => {
    const k = akisKur()
    k.akis.baslat(thread)
    await akit()
    k.akis.yenidenDenetle()
    await akit()
    expect(k.akis.bilgi().faz).toBe('araniyor')
    expect(k.ends).toEqual([])
    k.getCallStatus = vi.fn(async () => ({ status: 'active', reason: null }))
    k.akis.yenidenDenetle()
    await akit()
    expect(k.enters).toEqual(['c1'])
    expect(k.akis.bilgi().faz).toBe('konusma')
    vi.advanceTimersByTime(callTiming.ringMs)
    await akit()
    expect(k.ends).toEqual([]) // zil sayacı kalmadı
  })

  it("30 sn dolunca durum 'ringing' okunur, timeout gider; sonra 'active' gelirse (son anda kabul) konuşmaya bağlanılır", async () => {
    const k = akisKur()
    k.akis.baslat(thread)
    await akit()
    vi.advanceTimersByTime(callTiming.ringMs)
    await akit()
    expect(k.getCallStatus).toHaveBeenCalledWith('c1')
    expect(k.ends).toEqual([['c1', 'timeout']])
    expect(k.akis.bilgi()).toBeNull()
    expect(vi.getTimerCount()).toBe(0) // bırakılan arama için sayaç kurulmaz
    // Sunucu cevaplanmış aramayı timeout ile bitirmedi: "active" olayı gelir
    k.akis.olay({ callId: 'başka', threadId: 't1', status: 'active' }) // başka arama: yok sayılır
    expect(k.enters).toEqual([])
    k.akis.olay({ callId: 'c1', threadId: 't1', status: 'active' })
    expect(k.enters).toEqual(['c1'])
    expect(k.akis.bilgi()).toMatchObject({ faz: 'konusma', call: { id: 'c1' }, thread: { id: 't1' } })
    expect(k.ends).toEqual([['c1', 'timeout']]) // kapatma gönderilmez
  })

  it("zaman aşımıyla bırakılan arama: 'ended' gelirse unutulur; 60 sn sonra gelen 'active' yok sayılır", async () => {
    const k = akisKur()
    k.akis.baslat(thread)
    await akit()
    vi.advanceTimersByTime(callTiming.ringMs)
    await akit()
    k.akis.olay({ callId: 'c1', threadId: 't1', status: 'ended', reason: 'timeout' })
    k.akis.olay({ callId: 'c1', threadId: 't1', status: 'active' })
    expect(k.enters).toEqual([])

    const k2 = akisKur()
    k2.akis.baslat(thread)
    await akit()
    vi.advanceTimersByTime(callTiming.ringMs)
    await akit()
    vi.advanceTimersByTime(60_001)
    k2.akis.olay({ callId: 'c1', threadId: 't1', status: 'active' })
    expect(k2.enters).toEqual([])
    expect(k2.akis.bilgi()).toBeNull()
  })

  it("İptal edilen arama bırakılanlara girmez: sonradan 'active' gelse de bağlanılmaz (sunucu bitirir)", async () => {
    const k = akisKur()
    k.akis.baslat(thread)
    await akit()
    k.akis.iptal()
    k.akis.olay({ callId: 'c1', threadId: 't1', status: 'active' })
    expect(k.enters).toEqual([])
    expect(k.akis.bilgi()).toBeNull()
  })

  it('İptal: cancel ile biter, ton ve sayaç durur', async () => {
    const k = akisKur()
    k.akis.baslat(thread)
    await akit()
    k.akis.iptal()
    await akit()
    expect(k.ends).toEqual([['c1', 'cancel']])
    expect(k.tonDurdu).toBe(1)
    expect(k.beeps).toEqual(['leave'])
    expect(k.akis.bilgi()).toBeNull()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('startCall sürerken İptal: dönen arama cancel ile geri alınır, ton hiç çalmaz', async () => {
    const k = akisKur()
    let coz
    k.startCall = vi.fn(() => new Promise((r) => { coz = r }))
    k.akis.baslat(thread)
    k.akis.iptal()
    expect(k.akis.bilgi()).toBeNull()
    coz({ id: 'c9', status: 'ringing' })
    await akit()
    expect(k.ends).toEqual([['c9', 'cancel']])
    expect(k.tonlar).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('startCall sürerken aynı aramaya bağlanıldıysa (gelen kartından kabul) startCall dönünce o arama kapatılmaz', async () => {
    const k = akisKur()
    let coz
    k.startCall = vi.fn(() => new Promise((r) => { coz = r }))
    k.akis.baslat(thread)
    k.akis.iptal() // app.js onAccept: önce iptal, sonra baglan
    k.akis.baglan({ id: 'c9', status: 'active' }, thread)
    expect(k.akis.bilgi().faz).toBe('konusma')
    coz({ id: 'c9', status: 'active' }) // sunucu iki aramayı birleştirdi: aynı kimlik
    await akit()
    expect(k.ends).toEqual([])
    expect(k.akis.bilgi()).toMatchObject({ faz: 'konusma', call: { id: 'c9' } })
    expect(k.exits).toEqual([])
  })

  it('startCall sürerken başka bir aramaya bağlanıldıysa dönen (farklı) arama yine geri alınır', async () => {
    const k = akisKur()
    let coz
    k.startCall = vi.fn(() => new Promise((r) => { coz = r }))
    k.akis.baslat(thread)
    k.akis.iptal()
    k.akis.baglan({ id: 'c8', status: 'active' }, thread)
    coz({ id: 'c9', status: 'ringing' })
    await akit()
    expect(k.ends).toEqual([['c9', 'cancel']])
    expect(k.akis.bilgi()).toMatchObject({ faz: 'konusma', call: { id: 'c8' } })
  })

  it('ALREADY_IN_CALL: "Zaten bir aramadasın." (bilgi); arama başlamaz', async () => {
    const k = akisKur()
    k.startCall = vi.fn(async () => { throw hata('ALREADY_IN_CALL', 'Zaten bir aramadasın.') })
    k.akis.baslat(thread)
    await akit()
    expect(k.toasts).toEqual([['Zaten bir aramadasın.', 'bilgi']])
    expect(k.akis.bilgi()).toBeNull()
    expect(k.oncesi).toBe(0)
  })

  it('ikinci 📞 basışı yok sayılır', async () => {
    const k = akisKur()
    k.akis.baslat(thread)
    k.akis.baslat(thread)
    await akit()
    expect(k.startCall).toHaveBeenCalledTimes(1)
  })

  it('karşılıklı arama (startCall active döner): doğrudan konuşmaya geçilir, ton yok', async () => {
    const k = akisKur()
    k.startCall = vi.fn(async () => ({ id: 'c2', status: 'active' }))
    k.akis.baslat(thread)
    await akit()
    expect(k.enters).toEqual(['c2'])
    expect(k.akis.bilgi().faz).toBe('konusma')
    expect(k.tonlar).toBe(0)
  })

  it('BUSY: "ayla şu an başka bir aramada."; engel: "Bu kişiyi şu an arayamazsın."; arama başlamaz', async () => {
    const k = akisKur()
    k.startCall = vi.fn(async () => { throw hata('BUSY', 'Ad şu an başka bir aramada.') })
    k.akis.baslat(thread)
    await akit()
    expect(k.toasts).toEqual([['ayla şu an başka bir aramada.', 'bilgi']])
    expect(k.akis.bilgi()).toBeNull()
    expect(k.oncesi).toBe(0) // sesli kanaldan boşuna çıkılmaz
    k.startCall = vi.fn(async () => { throw hata('NOT_ALLOWED', 'Bu kişiye mesaj gönderemezsin.') })
    k.akis.baslat(thread)
    await akit()
    expect(k.toasts.at(-1)).toEqual(['Bu kişiyi şu an arayamazsın.', 'hata'])
    expect(vi.getTimerCount()).toBe(0)
  })

  it("'active' olayı: arayan sese girer, ton ve 30 sn sayacı durur", async () => {
    const k = akisKur()
    k.akis.baslat(thread)
    await akit()
    k.akis.olay({ callId: 'başka', threadId: 't1', status: 'active' }) // başka arama: yok sayılır
    expect(k.enters).toEqual([])
    k.akis.olay({ callId: 'c1', threadId: 't1', status: 'active' })
    expect(k.enters).toEqual(['c1'])
    expect(k.tonDurdu).toBe(1)
    expect(k.akis.bilgi().faz).toBe('konusma')
    vi.advanceTimersByTime(callTiming.ringMs)
    expect(k.ends).toEqual([]) // zaman aşımı kalmadı
  })

  it("'ended' olayı: reddetti / cevap yok / diğer nedenler bildirimsiz; hepsinde bitiş biplemesi", async () => {
    for (const [reason, metin] of [['decline', 'ayla aramayı reddetti.'], ['timeout', 'Cevap yok.'], ['cancel', null], ['lost', null]]) {
      const k = akisKur()
      k.akis.baslat(thread)
      await akit()
      k.akis.olay({ callId: 'c1', threadId: 't1', status: 'ended', reason })
      expect(k.toasts).toEqual(metin ? [[metin, 'bilgi']] : [])
      expect(k.beeps).toEqual(['leave'])
      expect(k.ends).toEqual([]) // sunucu zaten bitirdi
      expect(k.akis.bilgi()).toBeNull()
      expect(vi.getTimerCount()).toBe(0)
    }
  })

  it('startCall dönmeden gelen olay saklanır ve dönünce uygulanır', async () => {
    const k = akisKur()
    let coz
    k.startCall = vi.fn(() => new Promise((r) => { coz = r }))
    k.akis.baslat(thread)
    k.akis.olay({ callId: 'c1', threadId: 't1', status: 'active' })
    coz({ id: 'c1', status: 'ringing' })
    await akit()
    expect(k.enters).toEqual(['c1'])
    expect(k.akis.bilgi().faz).toBe('konusma')
  })
})

describe('konuşma', () => {
  async function konusmada() {
    const k = akisKur()
    k.startCall = vi.fn(async () => ({ id: 'c1', status: 'active' }))
    k.akis.baslat(thread)
    await akit()
    return k
  }

  it('süre sayacı ilerler: 42 sn sonra "00:42"; panel görünümü oturumdan', async () => {
    const k = await konusmada()
    k.oturum.esler(['u2'])
    vi.advanceTimersByTime(42_000)
    const g = aramaGorunumu(k.akis.bilgi(), ben)
    expect(g).toMatchObject({ faz: 'konusma', sure: '00:42', baglanti: null, self: ben, other: ayla })
    k.oturum.karsiDurumu({ muted: true, deafened: false })
    expect(aramaGorunumu(k.akis.bilgi(), ben).karsi).toEqual({ muted: true, deafened: false })
  })

  it('panel görünümü kamera/ekran durumunu ve hatasını oturumdan alır', async () => {
    const k = await konusmada()
    k.oturum.esler(['u2'])
    const st = k.oturum.getState()
    Object.assign(st, { camera: true, screen: false, cameraError: 'Kamera bulunamadı', screenError: null })
    const g = aramaGorunumu(k.akis.bilgi(), ben)
    expect(g.ben).toMatchObject({ camera: true, screen: false, status: 'connected' })
    expect(g.hata).toBe('Kamera bulunamadı')
  })

  it('aktifken 20 sn\'de bir pingCall; sunucu "bitti" derse yerelde kapanır', async () => {
    const k = await konusmada()
    k.oturum.esler(['u2'])
    vi.advanceTimersByTime(callTiming.pingMs * 2)
    expect(k.pingCall).toHaveBeenCalledTimes(2)
    expect(k.pingCall).toHaveBeenCalledWith('c1')
    k.pingCall.mockResolvedValue(false)
    vi.advanceTimersByTime(callTiming.pingMs)
    await akit()
    expect(k.exits).toEqual([null])
    expect(k.toasts).toEqual([['Arama bağlantısı koptu.', 'hata']])
    expect(k.akis.bilgi()).toBeNull()
    expect(vi.getTimerCount()).toBe(0)
    expect(k.oturum.dinleyiciSayisi()).toBe(0)
  })

  it('bağlantı koparsa "Bağlantı koptu, yeniden deneniyor…"; 15 sn içinde düzelmezse lost', async () => {
    const k = await konusmada()
    expect(k.akis.bilgi().baglanti).toBe('baglaniyor')
    expect(aramaGorunumu(k.akis.bilgi(), ben).baglanti).toBe('Bağlanıyor…')
    k.oturum.esler(['u2'])
    expect(k.akis.bilgi().baglanti).toBeNull()
    k.oturum.esler([])
    expect(aramaGorunumu(k.akis.bilgi(), ben).baglanti).toBe('Bağlantı koptu, yeniden deneniyor…')
    // Düzelirse sayaç kalkar
    vi.advanceTimersByTime(callTiming.lostMs - 1000)
    k.oturum.esler(['u2'])
    vi.advanceTimersByTime(callTiming.lostMs)
    expect(k.exits).toEqual([])
    // Yine koparsa (ya da bağlantı kurulamadı durumu) 15 sn sonra biter
    k.oturum.esler(['u2'], 'failed')
    vi.advanceTimersByTime(callTiming.lostMs)
    expect(k.exits).toEqual(['lost'])
    expect(k.toasts).toEqual([['Arama bağlantısı koptu.', 'hata']])
    expect(k.akis.bilgi()).toBeNull()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('karşıyla hiç bağlanılamazsa da arama asılı kalmaz (ilk bağlantı süresi sonunda lost)', async () => {
    const k = await konusmada()
    vi.advanceTimersByTime(callTiming.firstConnectMs)
    expect(k.exits).toEqual(['lost'])
    expect(vi.getTimerCount()).toBe(0)
  })

  it('Kapat: hangup; bütün sayaçlar ve dinleyiciler bırakılır', async () => {
    const k = await konusmada()
    k.akis.kapat()
    expect(k.exits).toEqual(['hangup'])
    expect(k.akis.bilgi()).toBeNull()
    expect(vi.getTimerCount()).toBe(0)
    expect(k.oturum.dinleyiciSayisi()).toBe(0)
  })

  it("karşı taraf kapatınca ('ended'): yalnız yerel kapanış, bildirim yok; 'lost' ise bildirim", async () => {
    const k = await konusmada()
    k.akis.olay({ callId: 'c1', threadId: 't1', status: 'ended', reason: 'hangup' })
    expect(k.exits).toEqual([null])
    expect(k.toasts).toEqual([])
    expect(vi.getTimerCount()).toBe(0)
    const k2 = await konusmada()
    k2.akis.olay({ callId: 'c1', threadId: 't1', status: 'ended', reason: 'lost' })
    expect(k2.toasts).toEqual([['Arama bağlantısı koptu.', 'hata']])
  })

  it('sesKapandi (uygulama aramayı başka yoldan kapattı): sayaçlar durur, exit tekrar çağrılmaz', async () => {
    const k = await konusmada()
    k.akis.sesKapandi('başka')
    expect(k.akis.bilgi().faz).toBe('konusma')
    k.akis.sesKapandi('c1')
    expect(k.akis.bilgi()).toBeNull()
    expect(k.exits).toEqual([])
    expect(vi.getTimerCount()).toBe(0)
  })

  it("yenidenDenetle konuşmada: arama bu arada bittiyse normal bitiş (exit(null), 'bağlantı koptu' yok)", async () => {
    const k = await konusmada()
    // Hâlâ sürüyorsa bir şey olmaz
    k.getCallStatus = vi.fn(async () => ({ status: 'active', reason: null }))
    await k.akis.yenidenDenetle()
    await akit()
    expect(k.getCallStatus).toHaveBeenCalledWith('c1')
    expect(k.akis.bilgi().faz).toBe('konusma')
    expect(k.exits).toEqual([])
    // Okunamazsa da bir şey olmaz (canlılık kuralı bakar)
    k.getCallStatus = vi.fn(async () => { throw new Error('ağ') })
    await k.akis.yenidenDenetle()
    expect(k.akis.bilgi().faz).toBe('konusma')
    // Kopukken karşı taraf kapattı: 'ended' okunur
    k.getCallStatus = vi.fn(async () => ({ status: 'ended', reason: 'hangup' }))
    await k.akis.yenidenDenetle()
    await akit()
    expect(k.exits).toEqual([null]) // yalnız yerel kapanış (biplemeyi oturum çalar)
    expect(k.toasts).toEqual([])
    expect(k.akis.bilgi()).toBeNull()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('İptal konuşmada bir şey yapmaz (orada Kapat var)', async () => {
    const k = await konusmada()
    k.akis.iptal()
    expect(k.akis.bilgi().faz).toBe('konusma')
    expect(k.exits).toEqual([])
  })
})
