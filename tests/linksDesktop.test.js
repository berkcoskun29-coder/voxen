// @vitest-environment jsdom
// Masaüstünde (Tauri) mesaj linki tarayıcıda açılır: tıklama yakalanır, openUrl çağrılır.
// Web'de dokunulmaz (tarayıcı target=_blank ile yeni sekmede açar).
import { describe, it, expect, vi, afterEach } from 'vitest'

const sahte = vi.hoisted(() => ({ openUrl: null }))
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: (...a) => sahte.openUrl(...a) }))

import { linkliMetin } from '../src/ui/links.js'

const tikla = (a) => {
  const olay = new MouseEvent('click', { bubbles: true, cancelable: true })
  a.dispatchEvent(olay)
  return olay
}
const linkKur = () => {
  const kap = document.createElement('div')
  kap.appendChild(linkliMetin('bak https://ornek.com/a?b=1'))
  document.body.appendChild(kap)
  return kap.querySelector('a.msg-link')
}

afterEach(() => {
  delete window.__TAURI_INTERNALS__
  document.body.innerHTML = ''
})

describe('masaüstünde mesaj linki', () => {
  it('Tauri içinde tıklama engellenir ve adres openUrl ile açılır', async () => {
    window.__TAURI_INTERNALS__ = {}
    sahte.openUrl = vi.fn(async () => {})
    const a = linkKur()
    const olay = tikla(a)
    expect(olay.defaultPrevented).toBe(true)
    await vi.waitFor(() => expect(sahte.openUrl).toHaveBeenCalledWith('https://ornek.com/a?b=1'))
  })

  it('web sürümünde tıklamaya dokunulmaz (openUrl çağrılmaz)', async () => {
    sahte.openUrl = vi.fn(async () => {})
    const a = linkKur()
    const olay = tikla(a)
    expect(olay.defaultPrevented).toBe(false)
    await new Promise((r) => setTimeout(r, 0))
    expect(sahte.openUrl).not.toHaveBeenCalled()
  })

  it('openUrl hata verirse sessizce geçer (yakalanmamış hata olmaz)', async () => {
    window.__TAURI_INTERNALS__ = {}
    sahte.openUrl = vi.fn(async () => { throw new Error('izin yok') })
    const a = linkKur()
    tikla(a)
    await vi.waitFor(() => expect(sahte.openUrl).toHaveBeenCalled())
    await new Promise((r) => setTimeout(r, 0))
  })

  it('masaüstünde orta tuş: engellenir ve openUrl çağrılır', async () => {
    window.__TAURI_INTERNALS__ = {}
    sahte.openUrl = vi.fn(async () => {})
    const a = linkKur()
    const olay = new MouseEvent('auxclick', { bubbles: true, cancelable: true, button: 1 })
    a.dispatchEvent(olay)
    expect(olay.defaultPrevented).toBe(true)
    await vi.waitFor(() => expect(sahte.openUrl).toHaveBeenCalledWith('https://ornek.com/a?b=1'))
  })

  it('masaüstünde sağ tuş (button 2) yok sayılır', async () => {
    window.__TAURI_INTERNALS__ = {}
    sahte.openUrl = vi.fn(async () => {})
    const a = linkKur()
    const olay = new MouseEvent('auxclick', { bubbles: true, cancelable: true, button: 2 })
    a.dispatchEvent(olay)
    expect(olay.defaultPrevented).toBe(false)
    await new Promise((r) => setTimeout(r, 0))
    expect(sahte.openUrl).not.toHaveBeenCalled()
  })

  it('web sürümünde orta tuşa dokunulmaz', async () => {
    sahte.openUrl = vi.fn(async () => {})
    const a = linkKur()
    const olay = new MouseEvent('auxclick', { bubbles: true, cancelable: true, button: 1 })
    a.dispatchEvent(olay)
    expect(olay.defaultPrevented).toBe(false)
    await new Promise((r) => setTimeout(r, 0))
    expect(sahte.openUrl).not.toHaveBeenCalled()
  })
})
