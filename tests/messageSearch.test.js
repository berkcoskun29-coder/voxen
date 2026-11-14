// @vitest-environment jsdom
// Mesaj arama arayüzü (v0.10.0): kutu, gecikme, sıra (eski cevap yenisini ezmez), sonuç paneli, güvenli vurgu,
// "Daha fazla", öneriler ve klavye.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createMessageSearch, yerYazisi, ARAMA_METINLERI } from '../src/ui/messageSearch.js'
import { ARAMA_UYARILARI } from '../src/data/aramaFiltre.js'

const sonuc = (id, ek = {}) => ({
  id, tur: 'channel', channel_id: 'c1', server_id: 's1', thread_id: null, is_group: false, yer_adi: 'genel',
  other_id: null, author_id: 'u2', author_name: 'ayla', content: `mesaj ${id} merhaba`, created_at: '2026-11-14T10:00:00Z',
  attachment_count: 0, ...ek,
})

let arama
let ara
let onOpen
function kur(ek = {}) {
  ara = vi.fn(async () => ({ sonuclar: [], dahaVar: false }))
  onOpen = vi.fn()
  arama = createMessageSearch({
    ara: (...a) => ara(...a),
    kapsam: () => 'sunucu',
    bilgi: () => ({ kisiler: ['ayla', 'berk'], kanallar: ['genel'] }),
    onOpen,
    ...ek,
  })
  document.body.append(arama.kutu, arama.panel)
  return arama
}
const girdi = () => document.querySelector('.search-input')
function yaz(metin) {
  const g = girdi()
  g.focus()
  g.value = metin
  g.setSelectionRange(metin.length, metin.length)
  g.dispatchEvent(new Event('input', { bubbles: true }))
}
const tus = (key) => girdi().dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
const durum = () => document.querySelector('.search-status').textContent
const sonuclar = () => [...document.querySelectorAll('.search-result')]

beforeEach(() => {
  vi.useFakeTimers()
  document.body.innerHTML = ''
})
afterEach(() => { arama?.destroy(); vi.useRealTimers() })

describe('arama kutusu ve panel', () => {
  it('yazınca 300 ms bekleyip bir kez arar; panel açılır', async () => {
    kur()
    yaz('me'); yaz('mer'); yaz('merhaba')
    await vi.advanceTimersByTimeAsync(299)
    expect(ara).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(ara).toHaveBeenCalledTimes(1)
    expect(ara.mock.calls[0][0].metin).toBe('merhaba')
    expect(ara.mock.calls[0][1]).toEqual({ oncesi: null })
    expect(arama.panel.hidden).toBe(false)
    await vi.advanceTimersByTimeAsync(0)
    expect(durum()).toBe(ARAMA_METINLERI.yok)
  })

  it('eski isteğin cevabı yenisini ezmez', async () => {
    kur()
    let birinciBitir
    ara.mockImplementationOnce(() => new Promise((r) => { birinciBitir = r }))
    ara.mockImplementationOnce(async () => ({ sonuclar: [sonuc(2)], dahaVar: false }))
    yaz('eski'); tus('Enter')
    yaz('yeni'); tus('Enter')
    await vi.advanceTimersByTimeAsync(0)
    birinciBitir({ sonuclar: [sonuc(1), sonuc(3)], dahaVar: false })
    await vi.advanceTimersByTimeAsync(0)
    expect(sonuclar().map((li) => li.dataset.id)).toEqual(['2'])
  })

  it('sonuç satırı: yazar, yer, tarih ve <mark> vurgusu; kullanıcı yazısı HTML olarak çalışmaz', async () => {
    kur()
    ara.mockResolvedValue({ sonuclar: [sonuc(5, { content: '<img src=x onerror=alert(1)> İstanbul’a gel', author_name: '<b>x</b>' })], dahaVar: false })
    yaz('istanbul'); tus('Enter')
    await vi.advanceTimersByTimeAsync(0)
    const li = sonuclar()[0]
    expect(li.querySelector('img')).toBe(null)
    expect(li.querySelector('b')).toBe(null)
    expect(li.querySelector('.search-result-author').textContent).toBe('<b>x</b>')
    expect(li.querySelector('.search-result-place').textContent).toBe('#genel')
    expect(li.querySelector('time').dateTime).toBe('2026-11-14T10:00:00.000Z')
    expect([...li.querySelectorAll('mark')].map((m) => m.textContent)).toEqual(['İstanbul'])
    expect(li.querySelector('.search-result-text').textContent).toContain('<img src=x')
    expect(durum()).toBe('1 sonuç')
  })

  it('"Daha fazla" imleçle devam eder ve sonuçları ekler', async () => {
    kur()
    ara.mockResolvedValueOnce({ sonuclar: [sonuc(30), sonuc(29)], dahaVar: true })
    ara.mockResolvedValueOnce({ sonuclar: [sonuc(10)], dahaVar: false })
    yaz('merhaba'); tus('Enter')
    await vi.advanceTimersByTimeAsync(0)
    const daha = document.querySelector('.search-more')
    expect(daha.hidden).toBe(false)
    expect(durum()).toBe('2+ sonuç')
    daha.click()
    await vi.advanceTimersByTimeAsync(0)
    expect(ara.mock.calls[1][1]).toEqual({ oncesi: 29 })
    expect(ara.mock.calls[1][0].metin).toBe('merhaba')
    expect(sonuclar().map((li) => li.dataset.id)).toEqual(['30', '29', '10'])
    expect(daha.hidden).toBe(true)
    expect(document.activeElement).toBe(sonuclar()[2].querySelector('button'))
  })

  it('"Daha fazla" sürerken yeni arama yapılırsa düğme kilitli kalmaz', async () => {
    kur()
    let bitir
    ara.mockResolvedValueOnce({ sonuclar: [sonuc(30), sonuc(29)], dahaVar: true })
    ara.mockImplementationOnce(() => new Promise((r) => { bitir = r }))
    ara.mockResolvedValueOnce({ sonuclar: [sonuc(50), sonuc(49)], dahaVar: true })
    yaz('merhaba'); tus('Enter')
    await vi.advanceTimersByTimeAsync(0)
    const daha = document.querySelector('.search-more')
    daha.click() // istek askıda kalır
    expect(daha.disabled).toBe(true)
    yaz('selam'); tus('Enter') // yeni arama
    await vi.advanceTimersByTimeAsync(0)
    bitir({ sonuclar: [sonuc(1)], dahaVar: false }) // eski cevap geç gelir, yok sayılır
    await vi.advanceTimersByTimeAsync(0)
    expect(sonuclar().map((li) => li.dataset.id)).toEqual(['50', '49'])
    expect(daha.hidden).toBe(false)
    expect(daha.disabled).toBe(false)
  })

  it('kısa sorgu yazarken paneli açmaz; Enter uyarıyı gösterir; hatalı filtre uyarısı', async () => {
    kur()
    yaz('a')
    await vi.advanceTimersByTimeAsync(400)
    expect(arama.panel.hidden).toBe(true)
    tus('Enter')
    expect(arama.panel.hidden).toBe(false)
    expect(durum()).toBe(ARAMA_UYARILARI.kisa)
    yaz('selam önce:dün')
    await vi.advanceTimersByTimeAsync(300)
    expect(durum()).toBe(ARAMA_UYARILARI.tarih)
    expect(ara).not.toHaveBeenCalled()
  })

  it('hata mesajı gösterilir', async () => {
    kur()
    ara.mockRejectedValue(new Error('Burada arama yapamazsın.'))
    yaz('selam'); tus('Enter')
    await vi.advanceTimersByTimeAsync(0)
    expect(durum()).toBe('Burada arama yapamazsın.')
  })

  it('sonuca tıklayınca onOpen; Esc paneli kapatır; sifirla kutuyu boşaltır', async () => {
    kur()
    ara.mockResolvedValue({ sonuclar: [sonuc(7)], dahaVar: false })
    yaz('merhaba'); tus('Enter')
    await vi.advanceTimersByTimeAsync(0)
    sonuclar()[0].querySelector('button').click()
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 7 }))
    arama.panel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(arama.panel.hidden).toBe(true)
    arama.sifirla()
    expect(girdi().value).toBe('')
    expect(sonuclar()).toEqual([])
  })

  it('boş kutu aramayı temizler ve paneli kapatır', async () => {
    kur()
    yaz('merhaba'); tus('Enter')
    await vi.advanceTimersByTimeAsync(0)
    yaz('')
    await vi.advanceTimersByTimeAsync(300)
    expect(arama.panel.hidden).toBe(true)
  })
})

describe('öneriler ve klavye', () => {
  it('boş kutuya odaklanınca filtre listesi (yardım ipucu) çıkar', () => {
    kur()
    girdi().focus()
    girdi().dispatchEvent(new Event('focus'))
    const kutu = document.querySelector('.search-suggest')
    expect(kutu.hidden).toBe(false)
    expect(document.querySelector('.search-suggest-title').hidden).toBe(false)
    expect([...document.querySelectorAll('.search-option-label')].map((e) => e.textContent)).toContain('kimden:')
    expect(girdi().getAttribute('aria-expanded')).toBe('true')
  })

  it('↓ + Enter öneriyi seçer; kimden: kişileri önerir', () => {
    kur()
    yaz('ki')
    tus('ArrowDown')
    expect(girdi().getAttribute('aria-activedescendant')).toBeTruthy()
    tus('Enter')
    expect(girdi().value).toBe('kimden:')
    expect([...document.querySelectorAll('.search-option-label')].map((e) => e.textContent)).toEqual(['ayla', 'berk'])
    tus('ArrowDown'); tus('Tab')
    expect(girdi().value).toBe('kimden:ayla ')
    expect(ara).not.toHaveBeenCalled() // seçim aramayı hemen değil, gecikmeyle başlatır
  })

  it('Esc önce öneriyi, sonra paneli kapatır', async () => {
    kur()
    yaz('merhaba'); tus('Enter')
    await vi.advanceTimersByTimeAsync(0)
    yaz('merhaba ki') // son kelime bir anahtarın başı: öneri açık
    expect(document.querySelector('.search-suggest').hidden).toBe(false)
    tus('Escape')
    expect(document.querySelector('.search-suggest').hidden).toBe(true)
    expect(arama.panel.hidden).toBe(false)
    tus('Escape')
    expect(arama.panel.hidden).toBe(true)
  })
})

describe('yerYazisi', () => {
  it('kanal, bire bir, grup', () => {
    expect(yerYazisi({ tur: 'channel', yer_adi: 'genel' })).toBe('#genel')
    expect(yerYazisi({ tur: 'dm', is_group: false, yer_adi: 'ayla' })).toBe('@ayla')
    expect(yerYazisi({ tur: 'dm', is_group: true, yer_adi: 'Oyun' })).toBe('Oyun')
    expect(yerYazisi({ tur: 'dm', is_group: false, yer_adi: null })).toBe('@Bilinmeyen')
  })
})
