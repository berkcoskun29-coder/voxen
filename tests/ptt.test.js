// @vitest-environment jsdom
// Bas-konuş denetleyicisi, ayarlar ve ayarlar ekranı
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { PttController, VAD_HANGOVER_MS, pttBeepName } from '../src/voice/ptt.js'
import { getSettings, updateSettings, onSettingsChange } from '../src/settings.js'
import { askPttKeyIfNeeded, openSettings } from '../src/ui/settings.js'

beforeEach(() => {
  localStorage.clear()
  document.body.innerHTML = ''
})
afterEach(() => vi.useRealTimers())

const tus = (type, code, ek = {}) => window.dispatchEvent(new KeyboardEvent(type, { code, ...ek }))

describe('PttController', () => {
  it('ptt modunda tuş basılıyken kapı açık, bırakınca kapalı', () => {
    const kapi = []
    const c = new PttController({ mode: 'ptt', key: 'KeyV', onGate: (a) => kapi.push(a) })
    tus('keydown', 'KeyV')
    tus('keydown', 'KeyV', { repeat: true }) // tekrar eden olay yok sayılır
    tus('keydown', 'KeyB') // başka tuş
    expect(kapi).toEqual([true])
    tus('keyup', 'KeyV')
    expect(kapi).toEqual([true, false])
    c.dispose()
  })

  it('tuş seçilmemişse (null) kapı hep kapalı', () => {
    const kapi = []
    const c = new PttController({ mode: 'ptt', key: null, onGate: (a) => kapi.push(a) })
    c.handleKey('KeyV', true)
    expect(kapi).toEqual([])
    c.dispose()
  })

  it('pencere odağı kaybolunca kapı kapanır', () => {
    const kapi = []
    const c = new PttController({ mode: 'ptt', key: 'KeyV', onGate: (a) => kapi.push(a) })
    tus('keydown', 'KeyV')
    window.dispatchEvent(new Event('blur'))
    expect(kapi).toEqual([true, false])
    c.dispose()
  })

  it('tuş seçme penceresi açıkken (suspended) tuşlar kapıyı açmaz; dispose sonrası dinlemez', () => {
    const kapi = []
    const c = new PttController({ mode: 'ptt', key: 'KeyV', onGate: (a) => kapi.push(a) })
    c.setSuspended(true)
    tus('keydown', 'KeyV')
    expect(kapi).toEqual([])
    c.setSuspended(false)
    c.dispose()
    tus('keydown', 'KeyV')
    expect(kapi).toEqual([])
  })

  it('vad modunda seviye eşik üstündeyken açık; düşünce 300 ms sonra kapanır', () => {
    vi.useFakeTimers()
    let seviye = 0
    const kapi = []
    const c = new PttController({ mode: 'vad', key: null, threshold: 0.02, getLevel: () => seviye, onGate: (a) => kapi.push(a) })
    vi.advanceTimersByTime(100)
    expect(kapi).toEqual([]) // sessizlik: kapalı kalır
    seviye = 0.1
    vi.advanceTimersByTime(100)
    expect(kapi).toEqual([true])
    seviye = 0 // ses düştü
    vi.advanceTimersByTime(VAD_HANGOVER_MS - 100)
    expect(kapi).toEqual([true]) // henüz kapanmadı (hangover)
    vi.advanceTimersByTime(200)
    expect(kapi).toEqual([true, false])
    c.dispose()
  })

  it('yazı kutusunda harf tuşu kapıyı açmaz; F13 açar; bırakma her zaman kapatır', () => {
    const kutu = document.createElement('textarea')
    document.body.appendChild(kutu)
    const yaz = (type, code) => kutu.dispatchEvent(new KeyboardEvent(type, { code, bubbles: true }))
    const kapi = []
    const harf = new PttController({ mode: 'ptt', key: 'KeyV', onGate: (a) => kapi.push(a) })
    yaz('keydown', 'KeyV')
    expect(kapi).toEqual([])
    tus('keydown', 'KeyV') // kutu dışında çalışır
    expect(kapi).toEqual([true])
    yaz('keyup', 'KeyV') // yazı kutusunda bırakınca da kapanır
    expect(kapi).toEqual([true, false])
    harf.dispose()
    const f = []
    const fTus = new PttController({ mode: 'ptt', key: 'F13', onGate: (a) => f.push(a) })
    yaz('keydown', 'F13')
    expect(f).toEqual([true])
    fTus.dispose()
  })

  it('bip: sadece ptt modunda ve susturulmamış/sağır değilken', () => {
    expect(pttBeepName(true, { mode: 'ptt' })).toBe('ptt-on')
    expect(pttBeepName(false, { mode: 'ptt' })).toBe('ptt-off')
    expect(pttBeepName(true, { mode: 'vad' })).toBeNull()
    expect(pttBeepName(true, { mode: 'ptt', muted: true })).toBeNull()
    expect(pttBeepName(true, { mode: 'ptt', deafened: true })).toBeNull()
  })

  it('vad modunda bas-konuş tuşu kapıyı açmaz', () => {
    const kapi = []
    const c = new PttController({ mode: 'vad', key: 'KeyV', onGate: (a) => kapi.push(a) })
    tus('keydown', 'KeyV')
    expect(kapi).toEqual([])
    c.dispose()
  })
})

describe('ayarlar', () => {
  it('varsayılanlar: bas-konuş modu, tuş yok, gürültü engelleme açık, 128 kbps', () => {
    expect(getSettings()).toMatchObject({ mode: 'ptt', pttKey: null, noiseSuppression: true, bitrateKbps: 128, vadThreshold: 0.02 })
  })

  it('kalite 32–128 dışına çıkamaz', () => {
    expect(updateSettings({ bitrateKbps: 500 }).bitrateKbps).toBe(128)
    expect(updateSettings({ bitrateKbps: 1 }).bitrateKbps).toBe(32)
    expect(getSettings().bitrateKbps).toBe(32)
  })

  it('eski gürültü engelleme anahtarı bir kez taşınır', () => {
    localStorage.setItem('voxen.settings.noiseSuppression', 'false')
    expect(getSettings().noiseSuppression).toBe(false)
    expect(localStorage.getItem('voxen.settings.noiseSuppression')).toBeNull()
    expect(JSON.parse(localStorage.getItem('voxen.settings')).noiseSuppression).toBe(false)
  })

  it('güncelleme dinleyicilere haber verir', () => {
    const cb = vi.fn()
    const birak = onSettingsChange(cb)
    updateSettings({ mode: 'vad' })
    expect(cb).toHaveBeenCalledWith(expect.objectContaining({ mode: 'vad' }))
    birak()
    updateSettings({ mode: 'ptt' })
    expect(cb).toHaveBeenCalledTimes(1)
  })
})

describe('ayarlar ekranı', () => {
  it('tuş yokken ptt modunda tuş seçme penceresi gösterilir; tuşa basıp onaylayınca kaydedilir', () => {
    const ptt = new PttController({ mode: 'ptt', key: null, listen: false })
    askPttKeyIfNeeded(ptt)
    expect(document.body.textContent).toContain('Kullanmak istediğin tuşa bas. Vazgeçmek için Esc.')
    tus('keydown', 'KeyV')
    expect(getSettings().pttKey).toBeNull() // önce tuşun adı gösterilir, onay beklenir
    tus('keydown', 'Enter') // Enter onaylar
    expect(getSettings().pttKey).toBe('KeyV')
    expect(document.querySelector('.modal-back')).toBeNull()
    ptt.dispose()
  })

  it('Esc tuş seçmeyi iptal eder; tuş zaten seçiliyse pencere açılmaz', () => {
    const ptt = new PttController({ mode: 'ptt', key: null, listen: false })
    askPttKeyIfNeeded(ptt)
    tus('keydown', 'Escape')
    expect(getSettings().pttKey).toBeNull()
    expect(document.querySelector('.modal-back')).toBeNull()
    updateSettings({ pttKey: 'KeyV' })
    expect(askPttKeyIfNeeded(ptt)).toBeNull()
    updateSettings({ pttKey: null, mode: 'vad' })
    expect(askPttKeyIfNeeded(ptt)).toBeNull() // vad modunda tuş gerekmez
    ptt.dispose()
  })

  it('ayarlar penceresi: uyarı metni, kalite kaydırıcısı 32–128 adım 8, değişince kaydeder', () => {
    updateSettings({ pttKey: 'KeyV' })
    const ptt = new PttController({ mode: 'ptt', key: 'KeyV', listen: false })
    openSettings({ ptt })
    expect(document.body.textContent).toContain('Oyunda kullandığın bas-konuş tuşundan farklı bir tuş seç.')
    expect(document.body.textContent).toContain('128 kbps')
    const kayd = document.querySelector('input[type=range][data-ayar=bitrate]')
    expect([kayd.min, kayd.max, kayd.step]).toEqual(['32', '128', '8'])
    kayd.value = '64'
    kayd.dispatchEvent(new Event('input'))
    expect(getSettings().bitrateKbps).toBe(64)
    expect(document.body.textContent).toContain('64 kbps')
    ptt.dispose()
  })

  it('ayarlar iki kez açılırsa tek pencere olur', () => {
    updateSettings({ pttKey: 'KeyV' }) // tuş seçme penceresi araya girmesin
    const ptt = new PttController({ mode: 'vad', key: null, listen: false })
    openSettings({ ptt })
    openSettings({ ptt })
    expect(document.querySelectorAll('.modal-back')).toHaveLength(1)
    ptt.dispose()
  })

  it('mod seçimi ayarı kaydeder ve vad hassasiyetini yalnızca vad modunda gösterir', () => {
    const ptt = new PttController({ mode: 'ptt', key: null, listen: false })
    openSettings({ ptt })
    const vad = document.querySelector('[data-ayar=vad-satiri]')
    expect(vad.hidden).toBe(true)
    const sec = document.querySelector('select[data-ayar=mod]')
    sec.value = 'vad'
    sec.dispatchEvent(new Event('change'))
    expect(getSettings().mode).toBe('vad')
    expect(vad.hidden).toBe(false)
    ptt.dispose()
  })
})
