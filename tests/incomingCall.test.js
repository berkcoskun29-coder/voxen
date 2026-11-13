// @vitest-environment jsdom
// Gelen arama kartı (DM araması, spec §2): kart, Kabul et / Reddet, zil, 30 sn kendiliğinden kapanma.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  createIncomingCall, incomingTiming, zilCalsinMi, seniAriyorMetni, GELEN_ARAMA_METINLERI,
} from '../src/ui/incomingCall.js'
import { toast, toastKutusunuAl } from '../src/ui/layout.js'

const ali = { id: 'u2', username: 'ali', color: '#e05b5b', avatar_url: null }
const thread = { id: 't1', other: ali, canSend: true }
const bosalt = async () => { for (let i = 0; i < 5; i++) await Promise.resolve() }

function kur(ek = {}) {
  const zilDurdur = vi.fn()
  const deps = {
    host: () => toastKutusunuAl(),
    answerCall: vi.fn(async (id) => ({ id, status: 'active' })),
    endCall: vi.fn(async () => {}),
    onAccept: vi.fn(),
    toast: vi.fn(),
    startRing: vi.fn(() => zilDurdur),
    ...ek,
  }
  const g = createIncomingCall(deps)
  return { g, deps, zilDurdur }
}
const kart = () => document.querySelector('.incoming-call')
const kabulDugmesi = () => kart().querySelector('.incoming-accept')
const reddetDugmesi = () => kart().querySelector('.incoming-decline')

beforeEach(() => {
  document.body.innerHTML = '<button id="once">önce</button>'
})
afterEach(() => { vi.useRealTimers() })

describe('zilCalsinMi', () => {
  it('"Rahatsız etmeyin"de ve "Bildirim sesi" kapalıyken çalmaz', () => {
    expect(zilCalsinMi({ durum: 'online', ayarlar: { ses: true, masaustu: true } })).toBe(true)
    expect(zilCalsinMi({ durum: 'idle', ayarlar: { ses: true } })).toBe(true)
    expect(zilCalsinMi({ durum: 'dnd', ayarlar: { ses: true } })).toBe(false)
    expect(zilCalsinMi({ durum: 'online', ayarlar: { ses: false } })).toBe(false)
  })
})

describe('gelen arama kartı', () => {
  it('sağ altta, bildirimlerin üstünde; "Ad seni arıyor", alertdialog, odak almaz, Tab ile düğmelere gelinir', () => {
    const { g } = kur()
    toast('önceki bildirim')
    document.querySelector('#once').focus()
    expect(g.goster({ callId: 'c1', thread })).toBe(true)
    const kutu = document.querySelector('.toast-stack')
    expect(kutu.firstElementChild).toBe(kart()) // bildirimlerin üstünde
    expect(kart().getAttribute('role')).toBe('alertdialog')
    // Tek duyuru: kartın kendi aria-live'ı yok; onu bir kez polite bildirim kutusu okur
    expect(kart().hasAttribute('aria-live')).toBe(false)
    expect(kart().closest('[aria-live]')).toBe(kutu)
    expect(kutu.getAttribute('aria-live')).toBe('polite')
    const baslik = document.getElementById(kart().getAttribute('aria-labelledby'))
    expect(baslik.textContent).toBe('ali seni arıyor')
    expect(seniAriyorMetni('ali')).toBe('ali seni arıyor')
    expect(document.activeElement.id).toBe('once') // odak çalınmaz
    for (const b of [kabulDugmesi(), reddetDugmesi()]) {
      expect(b.tagName).toBe('BUTTON')
      expect(b.tabIndex).toBe(0)
      expect(b.disabled).toBe(false)
    }
    expect(kabulDugmesi().textContent).toBe('Kabul et')
    expect(reddetDugmesi().textContent).toBe('Reddet')
    expect(kart().querySelector('.incoming-call-avatar').textContent).toBe('A')
    expect(g.acik()).toBe('c1')
    g.destroy()
  })

  it('ad bilinmiyorsa "Biri seni arıyor"; ad HTML olarak çalışmaz', () => {
    const { g } = kur()
    g.goster({ callId: 'c1', thread: { id: 't9', other: { id: 'u9' } } })
    expect(kart().querySelector('.incoming-call-title').textContent).toBe(`${GELEN_ARAMA_METINLERI.bilinmeyen} seni arıyor`)
    g.destroy()
    const k2 = kur()
    k2.g.goster({ callId: 'c2', thread: { id: 't1', other: { ...ali, username: '<b>x</b>' } } })
    expect(kart().querySelector('b')).toBeNull()
    k2.g.destroy()
  })

  it('kart bildirim kutusunun bildirim sınırına sayılmaz, düşürülmez', () => {
    const { g } = kur()
    g.goster({ callId: 'c1', thread })
    for (let i = 0; i < 8; i++) toast(`b${i}`)
    expect(kart()).not.toBeNull()
    expect(document.querySelectorAll('.toast-stack .toast')).toHaveLength(4)
    g.destroy()
  })

  it('zil açılınca çalar; zil=false (DND / ses kapalı) iken çalmaz ama kart görünür', () => {
    const a = kur()
    a.g.goster({ callId: 'c1', thread })
    expect(a.deps.startRing).toHaveBeenCalledTimes(1)
    a.g.destroy()
    expect(a.zilDurdur).toHaveBeenCalledTimes(1)
    const b = kur()
    b.g.goster({ callId: 'c2', thread, zil: false })
    expect(kart()).not.toBeNull()
    expect(b.deps.startRing).not.toHaveBeenCalled()
    b.g.destroy()
  })

  it('Reddet: kart kapanır, zil durur, endCall(id, "decline")', async () => {
    vi.useFakeTimers()
    const { g, deps, zilDurdur } = kur()
    g.goster({ callId: 'c1', thread })
    reddetDugmesi().click()
    await bosalt()
    expect(deps.endCall).toHaveBeenCalledWith('c1', 'decline')
    expect(kart()).toBeNull()
    expect(zilDurdur).toHaveBeenCalledTimes(1)
    expect(g.acik()).toBeNull()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('Reddet hatası sessizce yutulur', async () => {
    const { g } = kur({ endCall: vi.fn(async () => { throw new Error('ağ') }) })
    g.goster({ callId: 'c1', thread })
    reddetDugmesi().click()
    await bosalt()
    expect(kart()).toBeNull()
  })

  it('Kabul et: answerCall, sonra onAccept(call, thread); kart kapanır, zil durur', async () => {
    vi.useFakeTimers()
    const { g, deps, zilDurdur } = kur()
    g.goster({ callId: 'c1', thread })
    kabulDugmesi().click()
    expect(kart()).toBeNull()
    expect(zilDurdur).toHaveBeenCalledTimes(1)
    await bosalt()
    expect(deps.answerCall).toHaveBeenCalledWith('c1')
    expect(deps.onAccept).toHaveBeenCalledWith({ id: 'c1', status: 'active' }, thread)
    expect(deps.endCall).not.toHaveBeenCalled()
    expect(deps.toast).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('Kabul et ama arama bu arada bitmiş (hata ya da ended): "Arama sona erdi.", onAccept yok', async () => {
    const a = kur({ answerCall: vi.fn(async () => { throw new Error('NOT_RINGING') }) })
    a.g.goster({ callId: 'c1', thread })
    kabulDugmesi().click()
    await bosalt()
    expect(a.deps.onAccept).not.toHaveBeenCalled()
    expect(a.deps.toast).toHaveBeenCalledWith('Arama sona erdi.')
    expect(kart()).toBeNull()
    const b = kur({ answerCall: vi.fn(async (id) => ({ id, status: 'ended' })) })
    b.g.goster({ callId: 'c2', thread })
    kabulDugmesi().click()
    await bosalt()
    expect(b.deps.onAccept).not.toHaveBeenCalled()
    expect(b.deps.toast).toHaveBeenCalledWith('Arama sona erdi.')
  })

  it('30 sn sonra kart kendiliğinden kapanır; endCall çağrılmaz (zaman aşımını arayan gönderir)', () => {
    vi.useFakeTimers()
    const { g, deps, zilDurdur } = kur()
    g.goster({ callId: 'c1', thread })
    vi.advanceTimersByTime(incomingTiming.ringMs - 1)
    expect(kart()).not.toBeNull()
    vi.advanceTimersByTime(1)
    expect(kart()).toBeNull()
    expect(zilDurdur).toHaveBeenCalledTimes(1)
    expect(deps.endCall).not.toHaveBeenCalled()
    expect(g.acik()).toBeNull()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('kapat(id): yalnız o aramanın kartı kapanır (ended / başka yerde cevaplandı)', () => {
    vi.useFakeTimers()
    const { g, zilDurdur } = kur()
    g.goster({ callId: 'c1', thread })
    g.kapat('c9')
    expect(kart()).not.toBeNull()
    g.kapat('c1')
    expect(kart()).toBeNull()
    expect(zilDurdur).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('aynı anda tek kart: başka arama gösterilmez (false); aynı arama yeniden gösterilmez', () => {
    const { g, deps } = kur()
    expect(g.goster({ callId: 'c1', thread })).toBe(true)
    expect(g.goster({ callId: 'c1', thread })).toBe(true)
    expect(g.goster({ callId: 'c2', thread })).toBe(false)
    expect(document.querySelectorAll('.incoming-call')).toHaveLength(1)
    expect(deps.startRing).toHaveBeenCalledTimes(1)
    g.destroy()
  })

  it('reddet(): açık kart decline ile kapanır (giden arama / sesli kanal); kart yoksa bir şey yapmaz', async () => {
    vi.useFakeTimers()
    const { g, deps, zilDurdur } = kur()
    g.reddet()
    expect(deps.endCall).not.toHaveBeenCalled()
    g.goster({ callId: 'c1', thread })
    g.reddet()
    await bosalt()
    expect(deps.endCall).toHaveBeenCalledWith('c1', 'decline')
    expect(kart()).toBeNull()
    expect(zilDurdur).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('bildirimEkle: kart kapanınca masaüstü bildirimi de kapanır; kart yoksa hemen kapanır', () => {
    const { g } = kur()
    g.goster({ callId: 'c1', thread })
    const kapat = vi.fn()
    g.bildirimEkle('c1', kapat)
    expect(kapat).not.toHaveBeenCalled()
    g.kapat('c1')
    expect(kapat).toHaveBeenCalledTimes(1)
    const gec = vi.fn()
    g.bildirimEkle('c1', gec) // kart çoktan kapandı
    expect(gec).toHaveBeenCalledTimes(1)
  })

  it('kabulEdiliyor: answerCall sürerken { callId, thread }, bitince null; her değişimde onChange', async () => {
    let coz
    const onChange = vi.fn()
    const { g, deps } = kur({ answerCall: vi.fn(() => new Promise((r) => { coz = r })), onChange })
    expect(g.kabulEdiliyor()).toBeNull()
    g.goster({ callId: 'c1', thread })
    kabulDugmesi().click()
    expect(g.kabulEdiliyor()).toEqual({ callId: 'c1', thread })
    expect(g.acik()).toBeNull()
    expect(onChange).toHaveBeenCalledTimes(1)
    coz({ id: 'c1', status: 'active' })
    await bosalt()
    expect(g.kabulEdiliyor()).toBeNull()
    expect(deps.onAccept).toHaveBeenCalledTimes(1)
    // Başarısız kabulde de temizlenir ve onChange çağrılır (📞 yeniden etkin olsun)
    const b = kur({ answerCall: vi.fn(async () => { throw new Error('bitti') }), onChange })
    b.g.goster({ callId: 'c2', thread })
    kabulDugmesi().click()
    await bosalt()
    expect(b.g.kabulEdiliyor()).toBeNull()
    expect(onChange).toHaveBeenCalledTimes(3)
  })

  it('destroy: kart, zil ve sayaç kapanır; sonra gösterilmez; bekleyen kabul onAccept çağırmaz', async () => {
    vi.useFakeTimers()
    let coz
    const { g, deps, zilDurdur } = kur({ answerCall: vi.fn(() => new Promise((r) => { coz = r })) })
    g.goster({ callId: 'c1', thread })
    kabulDugmesi().click()
    g.destroy()
    coz({ id: 'c1', status: 'active' })
    await bosalt()
    expect(deps.onAccept).not.toHaveBeenCalled()
    expect(zilDurdur).toHaveBeenCalledTimes(1)
    expect(g.goster({ callId: 'c2', thread })).toBe(false)
    expect(kart()).toBeNull()
    expect(vi.getTimerCount()).toBe(0)
  })

  it("kabul sürerken destroy: answerCall 'active' dönerse arama hangup ile kapatılır (karşı taraf boşuna beklemez)", async () => {
    let coz
    const { g, deps } = kur({ answerCall: vi.fn(() => new Promise((r) => { coz = r })) })
    g.goster({ callId: 'c1', thread })
    kabulDugmesi().click()
    g.destroy()
    coz({ id: 'c1', status: 'active' })
    await bosalt()
    expect(deps.onAccept).not.toHaveBeenCalled()
    expect(deps.endCall).toHaveBeenCalledWith('c1', 'hangup')
    expect(deps.endCall).toHaveBeenCalledTimes(1)
  })

  it("kabul sürerken destroy: arama zaten bitmişse (ended ya da hata) endCall gönderilmez", async () => {
    let coz
    const a = kur({ answerCall: vi.fn(() => new Promise((r) => { coz = r })) })
    a.g.goster({ callId: 'c1', thread })
    kabulDugmesi().click()
    a.g.destroy()
    coz({ id: 'c1', status: 'ended' })
    await bosalt()
    expect(a.deps.endCall).not.toHaveBeenCalled()

    const b = kur({ answerCall: vi.fn(async () => { throw new Error('x') }), endCall: vi.fn(async () => { throw new Error('ağ') }) })
    b.g.goster({ callId: 'c2', thread })
    kabulDugmesi().click()
    b.g.destroy()
    await bosalt()
    expect(b.deps.endCall).not.toHaveBeenCalled()
  })

  it('kabul sürerken destroy: hangup hatası sessizce yutulur', async () => {
    let coz
    const { g, deps } = kur({ answerCall: vi.fn(() => new Promise((r) => { coz = r })), endCall: vi.fn(async () => { throw new Error('ağ') }) })
    g.goster({ callId: 'c1', thread })
    kabulDugmesi().click()
    g.destroy()
    coz({ id: 'c1', status: 'active' })
    await bosalt()
    expect(deps.endCall).toHaveBeenCalledWith('c1', 'hangup')
  })
})

describe('kart stili', () => {
  const css = readFileSync(join(process.cwd(), 'src/styles/theme.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
  it('Kabul et yeşil, Reddet kırmızı (tema değişkenleri); hareket azaltmada animasyon yok', () => {
    expect(css).toMatch(/\.incoming-accept\s*\{[^}]*background:\s*var\(--accent\)/)
    expect(css).toMatch(/\.incoming-decline\s*\{[^}]*background:\s*var\(--danger\)/)
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.incoming-call, \.incoming-call-avatar\s*\{\s*animation:\s*none/)
    expect(css).toMatch(/\.incoming-call\s*\{[^}]*pointer-events:\s*auto/) // kutu tıklamayı geçirir, kart almalı
  })
})
