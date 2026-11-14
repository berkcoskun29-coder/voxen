// @vitest-environment jsdom
// Ayarlar > Bildirimler (v0.13.0): tarayıcı izni düğmesi, masaüstünde "Kapatınca tepsiye küçült" ve
// "Windows açılışında başlat".
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const sahte = vi.hoisted(() => ({ tauri: false, autostart: false, autostartBasarili: true, tepsi: [] }))
vi.mock('../src/voice/pipeline.js', async (asil) => ({
  ...(await asil()),
  openMic: vi.fn(() => new Promise(() => {})),
  createVoicePipeline: vi.fn(),
}))
vi.mock('../src/desktop.js', async (asil) => ({
  ...(await asil()),
  isTauri: () => sahte.tauri,
  getAutostart: async () => sahte.autostart,
  setAutostart: async (acik) => { if (!sahte.autostartBasarili) return false; sahte.autostart = acik; return true },
  setCloseToTray: async (acik) => { sahte.tepsi.push(acik) },
}))

import { openSettings } from '../src/ui/settings.js'
import { updateSettings } from '../src/settings.js'
import { getTraySettings } from '../src/notify.js'

const bosalt = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)) }
const bolum = () => document.querySelector('#ayar-bolum-bildirimler')
const dugme = (yazi) => [...bolum().querySelectorAll('button')].find((b) => b.textContent === yazi)

let ayar = null
beforeEach(() => {
  localStorage.clear()
  document.body.innerHTML = ''
  sahte.tauri = false
  sahte.autostart = false
  sahte.autostartBasarili = true
  sahte.tepsi = []
  updateSettings({ pttKey: 'KeyV' })
})
afterEach(() => {
  ayar?.close()
  ayar = null
  vi.unstubAllGlobals()
})

describe('tarayıcı bildirim izni', () => {
  it('izin sorulmadıysa açıklama ve "Bildirimlere izin ver"; verilince kutu kaybolur', async () => {
    const izin = { permission: 'default', requestPermission: vi.fn(async () => { izin.permission = 'granted'; return 'granted' }) }
    vi.stubGlobal('Notification', izin)
    ayar = openSettings({})
    const kutu = bolum().querySelector('.notify-permission')
    expect(kutu.hidden).toBe(false)
    expect(kutu.textContent).toContain('Voxen sana bildirim gösterebilsin diye')
    dugme('Bildirimlere izin ver').click()
    await bosalt()
    expect(izin.requestPermission).toHaveBeenCalled()
    expect(kutu.hidden).toBe(true)
  })

  it('reddedildiyse tarayıcı ayarından açma bilgisi, düğme yok', () => {
    vi.stubGlobal('Notification', { permission: 'denied' })
    ayar = openSettings({})
    const kutu = bolum().querySelector('.notify-permission')
    expect(kutu.hidden).toBe(false)
    expect(kutu.textContent).toContain('engellendi')
    expect(dugme('Bildirimlere izin ver')).toBeUndefined()
  })

  it('izin verilmişse kutu gizli', () => {
    vi.stubGlobal('Notification', { permission: 'granted' })
    ayar = openSettings({})
    expect(bolum().querySelector('.notify-permission').hidden).toBe(true)
  })
})

describe('masaüstü: arka planda çalışma', () => {
  it('web\'de tepsi ve açılış ayarları görünmez', () => {
    ayar = openSettings({})
    expect(bolum().querySelector('#ayar-tepsi')).toBeNull()
    expect(bolum().querySelector('#ayar-acilis')).toBeNull()
  })

  it('Kapatınca tepsiye küçült: varsayılan açık; değişince saklanır ve Rust\'a bildirilir', () => {
    sahte.tauri = true
    ayar = openSettings({})
    const kutu = bolum().querySelector('#ayar-tepsi')
    expect(bolum().querySelector('label[for=ayar-tepsi]').textContent).toBe('Kapatınca tepsiye küçült')
    expect(kutu.checked).toBe(true)
    kutu.checked = false
    kutu.dispatchEvent(new Event('change'))
    expect(getTraySettings().tepsiyeKucult).toBe(false)
    expect(sahte.tepsi).toEqual([false])
  })

  it('Windows açılışında başlat: durum okunur; aç/kapa; başarısızsa geri alınır', async () => {
    sahte.tauri = true
    sahte.autostart = true
    ayar = openSettings({})
    const kutu = bolum().querySelector('#ayar-acilis')
    expect(bolum().querySelector('label[for=ayar-acilis]').textContent).toBe('Windows açılışında başlat')
    await bosalt()
    expect(kutu.checked).toBe(true)
    kutu.checked = false
    kutu.dispatchEvent(new Event('change'))
    await bosalt()
    expect(sahte.autostart).toBe(false)
    sahte.autostartBasarili = false
    kutu.checked = true
    kutu.dispatchEvent(new Event('change'))
    await bosalt()
    expect(kutu.checked).toBe(false)
    expect(bolum().textContent).toContain('Ayar değiştirilemedi')
  })
})
