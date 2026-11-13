// @vitest-environment jsdom
// Ayarlar > Bildirimler: iki açma kapama düğmesi (cihazda saklanır) ve sessize alınan sunucular listesi.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

vi.mock('../src/voice/pipeline.js', async (asil) => ({
  ...(await asil()),
  openMic: vi.fn(() => new Promise(() => {})),
  createVoicePipeline: vi.fn(),
}))

import { openSettings } from '../src/ui/settings.js'
import { updateSettings } from '../src/settings.js'
import { getNotifySettings } from '../src/notify.js'

const bosalt = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)) }
const sekme = (ad) => [...document.querySelectorAll('[role=tab]')].find((t) => t.textContent === ad)
const bolum = () => document.querySelector('#ayar-bolum-bildirimler')
const dugme = (yazi) => [...bolum().querySelectorAll('button')].find((b) => b.textContent === yazi)
const satirlar = () => [...bolum().querySelectorAll('.muted-server-row')].map((r) => r.querySelector('.muted-server-name').textContent)

let ayar = null
beforeEach(() => {
  localStorage.clear()
  document.body.innerHTML = ''
  updateSettings({ pttKey: 'KeyV' }) // tuş seçme penceresi açılmasın
})
afterEach(() => {
  ayar?.close()
  ayar = null
  vi.unstubAllGlobals()
})

describe('Ayarlar > Bildirimler', () => {
  it('yeni bölüm: başlık, iki düğme (varsayılan açık) ve "Sessize alınan sunucular"', () => {
    ayar = openSettings({})
    sekme('Bildirimler').click()
    expect(bolum().hidden).toBe(false)
    expect(bolum().querySelector('h3').textContent).toBe('Bildirimler')
    const masaustu = bolum().querySelector('#ayar-bildirim')
    const ses = bolum().querySelector('#ayar-bildirim-ses')
    expect(bolum().querySelector('label[for=ayar-bildirim]').textContent).toBe('Masaüstü bildirimleri')
    expect(bolum().querySelector('label[for=ayar-bildirim-ses]').textContent).toBe('Bildirim sesi')
    expect(masaustu.checked).toBe(true)
    expect(ses.checked).toBe(true)
    expect(bolum().textContent).toContain('Sessize alınan sunucular')
  })

  it('düğmeler cihazda saklanır ve yeniden açılışta korunur', () => {
    ayar = openSettings({})
    const ses = bolum().querySelector('#ayar-bildirim-ses')
    ses.checked = false
    ses.dispatchEvent(new Event('change'))
    const masaustu = bolum().querySelector('#ayar-bildirim')
    masaustu.checked = false
    masaustu.dispatchEvent(new Event('change'))
    expect(getNotifySettings()).toEqual({ masaustu: false, ses: false })
    expect(JSON.parse(localStorage.getItem('voxen.bildirimler'))).toEqual({ masaustu: false, ses: false })
    ayar.close()
    ayar = openSettings({})
    expect(bolum().querySelector('#ayar-bildirim').checked).toBe(false)
    expect(bolum().querySelector('#ayar-bildirim-ses').checked).toBe(false)
  })

  it('sessize alınan sunucular listelenir; "Sesi aç" onUnmute çağırır ve satır kalkar', async () => {
    let sessiz = [{ id: 's1', name: 'Kanka' }, { id: 's2', name: 'İş' }]
    const onUnmute = vi.fn(async (id) => { sessiz = sessiz.filter((s) => s.id !== id) })
    ayar = openSettings({ notify: { mutedServers: () => sessiz, onUnmute } })
    sekme('Bildirimler').click()
    expect(satirlar()).toEqual(['Kanka', 'İş'])
    const ac = dugme('Sesi aç')
    expect(ac.getAttribute('aria-label')).toBe('Kanka sesini aç')
    ac.click()
    expect(ac.disabled).toBe(true) // iş sürerken iki kez basılmasın
    await bosalt()
    expect(onUnmute).toHaveBeenCalledWith('s1')
    expect(satirlar()).toEqual(['İş'])
  })

  it('sesi açma başarısız olursa satır kalır ve düğme yeniden açılır', async () => {
    const onUnmute = vi.fn(async () => { throw new Error('ağ') })
    ayar = openSettings({ notify: { mutedServers: () => [{ id: 's1', name: 'Kanka' }], onUnmute } })
    dugme('Sesi aç').click()
    await bosalt()
    expect(satirlar()).toEqual(['Kanka'])
    expect(dugme('Sesi aç').disabled).toBe(false)
  })

  it('sunucu adı yazı olarak basılır (HTML yorumlanmaz); liste boşsa bunu söyler', () => {
    ayar = openSettings({ notify: { mutedServers: () => [{ id: 's1', name: '<b>x</b>' }] } })
    expect(satirlar()).toEqual(['<b>x</b>'])
    expect(bolum().querySelector('b')).toBeNull()
    ayar.close()
    ayar = openSettings({})
    expect(bolum().querySelector('.muted-servers-empty').textContent).toBe('Sessize alınan sunucu yok.')
  })

  it('tarayıcıda: bölüm açılınca izin bir kez istenir (henüz sorulmadıysa); düğme açılınca da', async () => {
    const istek = vi.fn(async () => 'granted')
    vi.stubGlobal('Notification', Object.assign(function () {}, { permission: 'default', requestPermission: istek }))
    ayar = openSettings({})
    expect(istek).not.toHaveBeenCalled() // Konuşma bölümü açık
    sekme('Bildirimler').click()
    expect(istek).toHaveBeenCalledTimes(1)
    const masaustu = bolum().querySelector('#ayar-bildirim')
    masaustu.checked = false
    masaustu.dispatchEvent(new Event('change'))
    masaustu.checked = true
    masaustu.dispatchEvent(new Event('change'))
    expect(istek).toHaveBeenCalledTimes(2)
  })
})

describe('Ayarlar > Bildirimler: izin sorusu', () => {
  it('bölüm açılınca izin oturum başına bir kez sorulur; düğmeyi açınca yine sorulur', async () => {
    vi.resetModules() // bayrak temiz başlasın
    const istek = vi.fn(async () => 'default') // kişi soruyu kapatıp geçti
    vi.stubGlobal('Notification', Object.assign(function () {}, { permission: 'default', requestPermission: istek }))
    const taze = await import('../src/ui/settings.js')
    const ayarlar = await import('../src/settings.js')
    const bildirim = await import('../src/notify.js')
    ayarlar.updateSettings({ pttKey: 'KeyV' })
    bildirim.setNotifySettings({ masaustu: true })
    const a = taze.openSettings({})
    for (let i = 0; i < 3; i++) { sekme('Bildirimler').click(); sekme('Konuşma').click() }
    await bosalt()
    expect(istek).toHaveBeenCalledTimes(1) // üç kez açıldı, bir kez soruldu
    // Kullanıcı açma düğmesine açıkça basınca sınır aşılır
    sekme('Bildirimler').click()
    const kutu = document.querySelector('#ayar-bildirim')
    kutu.checked = false; kutu.dispatchEvent(new Event('change'))
    kutu.checked = true; kutu.dispatchEvent(new Event('change'))
    await bosalt()
    expect(istek).toHaveBeenCalledTimes(2)
    a.close()
  })
})

describe('Ayarlar > Konuşma: yazı tuşu uyarısı', () => {
  const ayarUyarisi = () => document.querySelector('.field .key-warning')
  const pencereUyarisi = () => [...document.querySelectorAll('.key-warning')].find((e) => !e.closest('.field'))
  const tus = (code) => window.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true, cancelable: true }))

  it('yazı tuşunda uyarı görünür (role=note); F8, Mouse4, ControlLeft\'te görünmez', () => {
    for (const [kod, gorunur] of [['Backquote', true], ['KeyV', true], ['Quote', true], ['F8', false], ['Mouse4', false], ['ControlLeft', false]]) {
      updateSettings({ pttKey: kod })
      ayar = openSettings({})
      const u = ayarUyarisi()
      expect(u.getAttribute('role')).toBe('note')
      expect(u.hidden).toBe(!gorunur)
      expect(u.textContent).toBe('Bu tuş yazı yazarken çalışmaz. F tuşları, Ctrl/Alt ya da fare yan tuşu daha iyi olur.')
      ayar.close(); ayar = null
    }
  })

  it('tuş seçme penceresinde seçilen tuşa göre güncellenir; kaydedince ayarlardaki uyarı da güncellenir', async () => {
    updateSettings({ pttKey: 'F8' })
    ayar = openSettings({})
    expect(ayarUyarisi().hidden).toBe(true)
    document.querySelector('.key-row button').click() // Değiştir
    expect(pencereUyarisi().hidden).toBe(true) // henüz tuş seçilmedi
    tus('Backquote')
    expect(pencereUyarisi().hidden).toBe(false)
    tus('F9')
    expect(pencereUyarisi().hidden).toBe(true)
    tus('Quote')
    expect(pencereUyarisi().hidden).toBe(false)
    tus('Enter') // kaydet
    await bosalt()
    expect(ayarUyarisi().hidden).toBe(false)
  })
})
