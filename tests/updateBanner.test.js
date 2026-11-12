// @vitest-environment jsdom
// Güncelleme bandı: sesli kanaldayken görünmez, sürüm yazısını gösterir, Sonra/Güncelle çalışır
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createUpdateBanner, updateBannerText } from '../src/ui/updateBanner.js'

let sesli
beforeEach(() => { document.body.innerHTML = ''; sesli = false })

const yap = (extra = {}) => createUpdateBanner({ isInVoice: () => sesli, onInstall: vi.fn(), ...extra })
const bant = () => document.querySelector('.update-banner')

describe('updateBanner', () => {
  it('metin sürümü içerir', () => {
    expect(updateBannerText('0.2.0')).toBe('Yeni sürüm hazır (v0.2.0)')
  })
  it('sesli kanalda değilken sürüm metniyle gösterilir', () => {
    const b = yap()
    b.offer('0.2.0')
    expect(bant().textContent).toContain('Yeni sürüm hazır (v0.2.0)')
    expect(bant().textContent).toContain('Güncelle')
    expect(bant().textContent).toContain('Sonra')
  })
  it('sesli kanaldayken gösterilmez; kanaldan çıkınca refresh ile görünür', () => {
    const b = yap()
    sesli = true
    b.offer('0.2.0')
    expect(bant()).toBeNull()
    sesli = false
    b.refresh()
    expect(bant()).not.toBeNull()
  })
  it('sesli kanala girince açık bant kaldırılır', () => {
    const b = yap()
    b.offer('0.2.0')
    sesli = true
    b.refresh()
    expect(bant()).toBeNull()
  })
  it('Sonra bandı kapatır ve refresh onu geri getirmez', () => {
    const b = yap()
    b.offer('0.2.0')
    bant().querySelector('[data-act="later"]').click()
    expect(bant()).toBeNull()
    b.refresh()
    expect(bant()).toBeNull()
  })
  it('Sonra sonrası aynı sürüm tekrar gelirse gösterilmez, yeni sürüm gösterilir', () => {
    const b = yap()
    b.offer('0.2.0')
    bant().querySelector('[data-act="later"]').click()
    b.offer('0.2.0')
    expect(bant()).toBeNull()
    b.offer('0.3.0')
    expect(bant().textContent).toContain('v0.3.0')
  })
  it('Güncelle onInstall çağırır; sesli kanaldaysa çağırmaz', async () => {
    const onInstall = vi.fn().mockResolvedValue()
    const b = yap({ onInstall })
    b.offer('0.2.0')
    bant().querySelector('[data-act="install"]').click()
    expect(onInstall).toHaveBeenCalledTimes(1)
    sesli = true
    await b.install()
    expect(onInstall).toHaveBeenCalledTimes(1)
  })
  it('kurulum hata verirse bant geri döner ve onError çağrılır', async () => {
    const onError = vi.fn()
    const b = yap({ onInstall: vi.fn().mockRejectedValue(new Error('ağ')), onError })
    b.offer('0.2.0')
    await b.install()
    expect(onError).toHaveBeenCalled()
    expect(bant().querySelector('[data-act="install"]').disabled).toBe(false)
  })
  it('dispose bandı kaldırır', () => {
    const b = yap()
    b.offer('0.2.0')
    b.dispose()
    expect(bant()).toBeNull()
  })
})
