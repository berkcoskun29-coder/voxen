// @vitest-environment jsdom
// Sıfırlama linkinden dönüş: sayfa açılırken "şifre yenile" modu işaretliyse (src/auth/recovery.js),
// oturum olsa bile uygulama AÇILMAZ; önce yeni şifre formu gösterilir.
import { describe, it, expect, vi } from 'vitest'

const sira = vi.hoisted(() => [])
const durum = vi.hoisted(() => ({ session: { user: { id: 'u1' } }, authCb: null }))

vi.mock('../src/auth/auth.js', () => ({
  getSession: async () => durum.session,
  getMyProfile: async () => ({ id: 'u1', username: 'berk', color: '#3be37a' }),
  onAuthChange: (cb) => { durum.authCb = cb },
  signOut: async () => { sira.push('signOut') },
}))
vi.mock('../src/auth/authView.js', () => ({
  renderAuthView: (_k, _cb, secenek) => sira.push(['giris-ekrani', secenek?.mod ?? 'giris']),
  renderNewPasswordView: (_kap, cb) => { durum.yeniSifre = cb; sira.push('yeni-sifre') },
}))
vi.mock('../src/auth/profileModal.js', () => ({ renderCompleteProfile: () => {} }))
vi.mock('../src/ui/app.js', () => ({
  startApp: () => sira.push('startApp'),
  stopApp: () => sira.push('stopApp'),
}))

localStorage.setItem('voxen.sifreYenile', '1')
document.body.innerHTML = '<div id="app"></div>'
await import('../src/main.js')
const bosalt = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)) }

describe('sıfırlama linkinden açılış', () => {
  it('oturum açık olsa da uygulama yerine yeni şifre formu; Çıkış yap oturumu kapatır', async () => {
    await bosalt()
    expect(sira).toEqual(['stopApp', 'yeni-sifre'])
    await durum.yeniSifre.onCikis()
    expect(sira.at(-1)).toBe('signOut')
    // Çıkış olayı gelince mod temizlenir, giriş ekranı açılır
    durum.session = null
    durum.authCb(null, 'SIGNED_OUT')
    await bosalt()
    expect(localStorage.getItem('voxen.sifreYenile')).toBeNull()
    expect(sira.at(-1)).toEqual(['giris-ekrani', 'giris'])
  })
})
