// @vitest-environment jsdom
// Uygulama başlangıcı: oturum Çıkış düğmesi dışında biterse (başka sekme, süresi dolan oturum)
// önce uygulama durdurulur (sesli kanal, mikrofon, varlık, bas-konuş), sonra giriş ekranı gelir.
import { describe, it, expect, vi } from 'vitest'

const sira = vi.hoisted(() => [])
const durum = vi.hoisted(() => ({ session: { user: { id: 'u1' } }, authCb: null }))

vi.mock('../src/auth/auth.js', () => ({
  getSession: async () => durum.session,
  getMyProfile: async () => ({ id: 'u1', username: 'berk', color: '#3be37a' }),
  onAuthChange: (cb) => { durum.authCb = cb },
  signOut: async () => {},
}))
vi.mock('../src/auth/authView.js', () => ({
  renderAuthView: () => sira.push('giris-ekrani'),
  renderNewPasswordView: (_kap, cb) => { durum.yeniSifre = cb; sira.push('yeni-sifre') },
}))
vi.mock('../src/auth/profileModal.js', () => ({ renderCompleteProfile: () => {} }))
vi.mock('../src/ui/app.js', () => ({
  startApp: () => sira.push('startApp'),
  stopApp: () => sira.push('stopApp'),
}))

document.body.innerHTML = '<div id="app"></div>'
await import('../src/main.js')
const bosalt = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)) }

describe('main.js oturum değişimi', () => {
  it('oturum kapanınca önce stopApp, sonra giriş ekranı', async () => {
    await bosalt()
    expect(sira).toEqual(['startApp'])
    durum.session = null
    durum.authCb(null)
    await bosalt()
    expect(sira).toEqual(['startApp', 'stopApp', 'giris-ekrani'])
  })

  it('PASSWORD_RECOVERY gelince uygulama durur, yeni şifre formu açılır; kaydedince uygulama açılır', async () => {
    durum.session = { user: { id: 'u1' } }
    sira.length = 0
    durum.authCb(durum.session, 'PASSWORD_RECOVERY')
    await bosalt()
    expect(sira).toEqual(['stopApp', 'yeni-sifre'])
    expect(Number(localStorage.getItem('voxen.sifreYenile'))).toBeGreaterThan(0)
    // Aynı olay ikinci kez gelirse form yeniden çizilmez (yazılanlar kaybolmasın)
    durum.authCb(durum.session, 'PASSWORD_RECOVERY')
    await bosalt()
    expect(sira).toEqual(['stopApp', 'yeni-sifre'])
    durum.yeniSifre.onDone()
    await bosalt()
    expect(sira).toEqual(['stopApp', 'yeni-sifre', 'startApp'])
    expect(localStorage.getItem('voxen.sifreYenile')).toBeNull()
    expect(document.querySelector('.toast').textContent).toBe('Şifren değiştirildi.')
  })
})
