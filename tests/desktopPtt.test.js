// @vitest-environment jsdom
// Masaüstü (Tauri) sürümünde bas-konuş: Rust'taki tuş dinleyicisinden gelen `ptt-key` olayları
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { PttController, connectDesktopPtt, pttHintText, PTT_HOOK_ERROR_TEXT } from '../src/voice/ptt.js'
import { isTauri } from '../src/desktop.js'
import { updateSettings } from '../src/settings.js'
import { openSettings } from '../src/ui/settings.js'

// Sahte Tauri API'si: listen ile kaydedilen dinleyiciyi elle tetikleriz, invoke çağrılarını kaydederiz
function sahteTauri({ kancaDurumu = null } = {}) {
  const dinleyiciler = new Map()
  const cagrilar = []
  return {
    cagrilar,
    yay: (ad, payload) => dinleyiciler.get(ad)?.({ event: ad, payload }),
    dinleniyor: (ad) => dinleyiciler.has(ad),
    api: {
      listen: async (ad, cb) => { dinleyiciler.set(ad, cb); return () => dinleyiciler.delete(ad) },
      invoke: async (komut, args) => {
        if (komut === 'ptt_hook_status') return kancaDurumu
        cagrilar.push([komut, args])
      },
    },
  }
}

const tus = (type, code) => window.dispatchEvent(new KeyboardEvent(type, { code }))

beforeEach(() => {
  localStorage.clear()
  document.body.innerHTML = ''
})
afterEach(() => { delete window.__TAURI_INTERNALS__ })

describe('masaüstü bas-konuş', () => {
  it('Tauri yokken isTauri false, varken true', () => {
    expect(isTauri()).toBe(false)
    window.__TAURI_INTERNALS__ = {}
    expect(isTauri()).toBe(true)
  })

  it('ptt-key olayları kapıyı açıp kapatır; seçili tuş Rust tarafına bildirilir', async () => {
    const t = sahteTauri()
    const kapi = []
    const c = new PttController({ mode: 'ptt', key: 'KeyV', listen: false, onGate: (a) => kapi.push(a) })
    const birak = await connectDesktopPtt(c, t.api)
    expect(t.cagrilar).toEqual([['set_ptt_key', { code: 'KeyV' }]])
    t.yay('ptt-key', { code: 'KeyV', down: true })
    expect(kapi).toEqual([true])
    t.yay('ptt-key', { code: 'KeyV', down: false })
    expect(kapi).toEqual([true, false])
    c.setKey('F13') // tuş değişince Rust'a yeni tuş, tuş silinince null gider
    c.setKey(null)
    expect(t.cagrilar.slice(1)).toEqual([['set_ptt_key', { code: 'F13' }], ['set_ptt_key', { code: null }]])
    birak()
    expect(t.dinleniyor('ptt-key')).toBe(false)
    c.dispose()
  })

  it('bağlantı kesilince (Çıkış/oturum sonu) Rust tarafında tuş bırakılır', async () => {
    const t = sahteTauri()
    const c = new PttController({ mode: 'ptt', key: 'KeyV', listen: false })
    const birak = await connectDesktopPtt(c, t.api)
    birak()
    expect(t.cagrilar.at(-1)).toEqual(['set_ptt_key', { code: null }])
    c.dispose()
  })

  it('pencere odağı kaybolunca kapı KAPANMAZ (oyun öndeyken konuşulur); tuş bırakılınca kapanır', async () => {
    const t = sahteTauri()
    const kapi = []
    const c = new PttController({ mode: 'ptt', key: 'KeyV', listen: false, onGate: (a) => kapi.push(a) })
    await connectDesktopPtt(c, t.api)
    t.yay('ptt-key', { code: 'KeyV', down: true })
    window.dispatchEvent(new Event('blur'))
    expect(kapi).toEqual([true])
    t.yay('ptt-key', { code: 'KeyV', down: false })
    expect(kapi).toEqual([true, false])
    c.dispose()
  })

  it('tarayıcının kendi tuş olayları yok sayılır (çift işlem olmaz)', async () => {
    const t = sahteTauri()
    const kapi = []
    const c = new PttController({ mode: 'ptt', key: 'KeyV', listen: false, onGate: (a) => kapi.push(a) })
    await connectDesktopPtt(c, t.api)
    tus('keydown', 'KeyV')
    expect(kapi).toEqual([])
    t.yay('ptt-key', { code: 'KeyV', down: true })
    tus('keyup', 'KeyV') // tarayıcının bırakması da yok sayılır; kapıyı dinleyici yönetir
    expect(kapi).toEqual([true])
    t.yay('ptt-key', { code: 'KeyV', down: false })
    expect(kapi).toEqual([true, false])
    c.dispose()
  })

  it('Voxen penceresinde yazı kutusuna harf yazarken açılmaz; F13 açar', async () => {
    const t = sahteTauri()
    const kutu = document.createElement('textarea')
    document.body.appendChild(kutu)
    kutu.focus()
    const kapi = []
    const c = new PttController({ mode: 'ptt', key: 'KeyV', listen: false, onGate: (a) => kapi.push(a) })
    await connectDesktopPtt(c, t.api)
    t.yay('ptt-key', { code: 'KeyV', down: true })
    expect(kapi).toEqual([])
    t.yay('ptt-key', { code: 'KeyV', down: false })
    c.setKey('F13')
    t.yay('ptt-key', { code: 'F13', down: true })
    expect(kapi).toEqual([true])
    c.dispose()
  })

  it('Voxen arka plandayken (oyun öndeyken) yazı kutusu seçili kalsa da harf tuşu açar', async () => {
    const t = sahteTauri()
    const kutu = document.createElement('textarea')
    document.body.appendChild(kutu)
    kutu.focus()
    const hasFocus = document.hasFocus
    document.hasFocus = () => false
    try {
      const kapi = []
      const c = new PttController({ mode: 'ptt', key: 'KeyV', listen: false, onGate: (a) => kapi.push(a) })
      await connectDesktopPtt(c, t.api)
      t.yay('ptt-key', { code: 'KeyV', down: true })
      expect(kapi).toEqual([true])
      c.dispose()
    } finally {
      document.hasFocus = hasFocus
    }
  })

  it('kanca hatası olay olarak gelirse ya da açılışta zaten varsa bildirilir', async () => {
    const t = sahteTauri()
    const hatalar = []
    const c = new PttController({ mode: 'ptt', key: 'KeyV', listen: false })
    const birak = await connectDesktopPtt(c, t.api, { onHookError: (m) => hatalar.push(m) })
    expect(hatalar).toEqual([])
    t.yay('ptt-hook-error', 'ptt hook başlatılamadı')
    expect(hatalar).toEqual(['ptt hook başlatılamadı'])
    birak()
    expect(t.dinleniyor('ptt-hook-error')).toBe(false)
    c.dispose()

    const t2 = sahteTauri({ kancaDurumu: 'ptt hook iş parçacığı durdu' })
    const hatalar2 = []
    const c2 = new PttController({ mode: 'ptt', key: 'KeyV', listen: false })
    await connectDesktopPtt(c2, t2.api, { onHookError: (m) => hatalar2.push(m) })
    expect(hatalar2).toEqual(['ptt hook iş parçacığı durdu'])
    c2.dispose()
  })

  it('ses panelindeki ipucu: kanca hatası bas-konuş modunda gösterilir', () => {
    expect(PTT_HOOK_ERROR_TEXT).toBe('Bas-konuş tuşu dinlenemiyor')
    expect(pttHintText({ mode: 'ptt', pttKey: 'KeyV', hookError: false })).toBeNull()
    expect(pttHintText({ mode: 'ptt', pttKey: null, hookError: false })).toBe('Bas-konuş tuşu seçilmedi')
    // Kanca hatasında ipucu yönetici notunu da söyler (oyun yönetici olarak çalışıyorsa kanca tuşu göremez)
    expect(pttHintText({ mode: 'ptt', pttKey: 'KeyV', hookError: true }))
      .toBe("Bas-konuş tuşu dinlenemiyor. Oyun yönetici olarak çalışıyorsa Voxen'i de yönetici olarak çalıştır.")
    expect(pttHintText({ mode: 'vad', pttKey: null, hookError: true })).toBeNull() // sesle algılamada tuş gerekmez
  })

  it('ayarlarda yönetici notu yalnızca masaüstünde görünür', () => {
    updateSettings({ pttKey: 'KeyV' })
    const not = "Oyun yönetici olarak çalışıyorsa ve tuş algılanmıyorsa Voxen'i de yönetici olarak çalıştır."
    const c = new PttController({ mode: 'ptt', key: 'KeyV', listen: false })
    openSettings({ ptt: c }).close()
    expect(document.body.textContent).not.toContain(not)
    openSettings({ ptt: c })
    expect(document.body.textContent).not.toContain(not)
    document.body.innerHTML = ''
    window.__TAURI_INTERNALS__ = {}
    openSettings({ ptt: c })
    expect(document.body.textContent).toContain(not)
    c.dispose()
  })
})

describe('masaüstü penceresi (tauri.conf.json)', () => {
  it('arka planda/örtülüyken zamanlayıcılar yavaşlatılmaz; wry varsayılan argümanları korunur', async () => {
    const { readFileSync } = await import('node:fs')
    const conf = JSON.parse(readFileSync('src-tauri/tauri.conf.json', 'utf8'))
    const args = conf.app.windows[0].additionalBrowserArgs
    // wry'nin kendi varsayılanı (ayar verilince yerine geçtiği için elle eklenmeli)
    expect(args).toContain('--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection')
    // wry autoplay açıkken (varsayılan) bunu da ekler; bizim ayarımız yerine geçtiği için elle ekliyoruz
    expect(args).toContain('--autoplay-policy=no-user-gesture-required')
    for (const a of ['--disable-background-timer-throttling', '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows']) expect(args).toContain(a)
  })
})
