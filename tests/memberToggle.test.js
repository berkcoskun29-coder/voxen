// @vitest-environment jsdom
// Üyeler düğmesi (T12): sağdaki üye panelini açıp kapatır; seçim tarayıcıda hatırlanır.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mountLayout, createMemberToggle } from '../src/ui/layout.js'

const genislik = (px) => Object.defineProperty(window, 'innerWidth', { configurable: true, value: px })

let kapat = null
beforeEach(() => {
  localStorage.clear()
  document.body.innerHTML = '<div id="app"></div>'
})
afterEach(() => { kapat?.(); kapat = null; vi.restoreAllMocks() })

function kur() {
  const { members } = mountLayout(document.getElementById('app'))
  const t = createMemberToggle(members)
  kapat = t.dispose
  return { members, dugme: t.button }
}

describe('Üyeler düğmesi', () => {
  it('geniş pencerede panel açık başlar; düğme erişilebilir', () => {
    genislik(1400)
    const { members, dugme } = kur()
    expect(members.hidden).toBe(false)
    expect(dugme.getAttribute('aria-pressed')).toBe('true')
    expect(dugme.getAttribute('aria-controls')).toBe(members.id)
    expect(members.id).not.toBe('')
    expect(dugme.dataset.tip).toBe('Üyeler')
    expect(dugme.getAttribute('aria-label')).toBe('Üyeler')
    expect(dugme.querySelector('svg')).not.toBeNull()
  })

  it('1100pxten dar pencerede panel kapalı başlar', () => {
    genislik(1000)
    const { members, dugme } = kur()
    expect(members.hidden).toBe(true)
    expect(dugme.getAttribute('aria-pressed')).toBe('false')
  })

  it('tıklayınca açılıp kapanır ve seçim hatırlanır', () => {
    genislik(1000)
    let { members, dugme } = kur()
    dugme.click()
    expect(members.hidden).toBe(false)
    expect(dugme.getAttribute('aria-pressed')).toBe('true')
    kapat()
    // Yeniden açılış: dar pencere olsa da son seçim (açık) geçerli
    ;({ members, dugme } = kur())
    expect(members.hidden).toBe(false)
    dugme.click()
    expect(members.hidden).toBe(true)
    kapat()
    genislik(1400)
    ;({ members } = kur())
    expect(members.hidden).toBe(true) // geniş pencerede de kapalı seçim hatırlanır
  })

  it('localStorage hata verse de çalışır', () => {
    genislik(1400)
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('engelli') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('engelli') })
    const { members, dugme } = kur()
    expect(members.hidden).toBe(false)
    dugme.click()
    expect(members.hidden).toBe(true)
  })

  it('seçim yapılmadıysa pencere daralınca panel kendiliğinden kapanır', () => {
    genislik(1400)
    const { members } = kur()
    genislik(900)
    window.dispatchEvent(new Event('resize'))
    expect(members.hidden).toBe(true)
  })
})
