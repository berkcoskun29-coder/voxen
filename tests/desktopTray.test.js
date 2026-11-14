// @vitest-environment jsdom
// Masaüstü arka plan köprüleri (src/desktop.js, v0.13.0): kapatma davranışı, tepsi DND işareti, autostart.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const sahte = vi.hoisted(() => ({ cagrilar: [], acik: false, hata: false }))
vi.mock('@tauri-apps/api/core', () => ({
  invoke: async (ad, arg) => { sahte.cagrilar.push([ad, arg]) },
}))
vi.mock('@tauri-apps/plugin-autostart', () => ({
  isEnabled: async () => { if (sahte.hata) throw new Error('x'); return sahte.acik },
  enable: async () => { if (sahte.hata) throw new Error('x'); sahte.acik = true },
  disable: async () => { sahte.acik = false },
}))

import { setCloseToTray, setTrayDnd, getAutostart, setAutostart } from '../src/desktop.js'

beforeEach(() => { sahte.cagrilar = []; sahte.acik = false; sahte.hata = false })
afterEach(() => { delete window.__TAURI_INTERNALS__ })

describe('masaüstü arka plan köprüleri', () => {
  it('web\'de hiçbir şey çağrılmaz; autostart false', async () => {
    await setCloseToTray(false)
    await setTrayDnd(true)
    expect(sahte.cagrilar).toEqual([])
    expect(await getAutostart()).toBe(false)
    expect(await setAutostart(true)).toBe(false)
  })

  it('masaüstünde Rust komutları çağrılır', async () => {
    window.__TAURI_INTERNALS__ = {}
    await setCloseToTray(false)
    await setTrayDnd(true)
    expect(sahte.cagrilar).toEqual([['set_close_to_tray', { acik: false }], ['set_tray_dnd', { acik: true }]])
  })

  it('autostart aç/kapa ve durum; hata olursa false', async () => {
    window.__TAURI_INTERNALS__ = {}
    expect(await getAutostart()).toBe(false)
    expect(await setAutostart(true)).toBe(true)
    expect(await getAutostart()).toBe(true)
    expect(await setAutostart(false)).toBe(true)
    expect(await getAutostart()).toBe(false)
    sahte.hata = true
    expect(await setAutostart(true)).toBe(false)
    expect(await getAutostart()).toBe(false)
  })
})
