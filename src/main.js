// Uygulamanın başlangıcı: oturuma göre doğru ekranı gösterir.
import './styles/theme.css'
import { getSession, getMyProfile, onAuthChange } from './auth/auth.js'
import { renderAuthView } from './auth/authView.js'
import { renderCompleteProfile } from './auth/profileModal.js'
import { startApp, stopApp } from './ui/app.js'
import { inviteFromHash, storePendingInvite } from './ui/invite.js'

const app = document.querySelector('#app')

// mesaj: (varsa) "Profilini tamamla" ekranında gösterilecek hata
async function goster(mesaj) {
  const session = await getSession()
  if (!session) {
    // Giriş yoksa ve adreste davet kodu varsa, girişten sonra kullanmak için sakla
    const davet = inviteFromHash()
    if (davet) storePendingInvite(davet)
    return renderAuthView(app, goster) // oturum yok → giriş ekranı
  }

  const profil = await getMyProfile(session.user.id)
  if (!profil) return renderCompleteProfile(app, session.user.id, goster, typeof mesaj === 'string' ? mesaj : '') // profil yok → tamamla

  startApp(app, profil) // gerçek düzen: sunucular, kanallar
}

// Oturum bitince (Çıkış, başka sekmede çıkış, süresi dolan oturum) giriş ekranına dön.
// Önce uygulamayı durdur: sesli kanaldan ayrıl, mikrofonu, varlığı ve bas-konuşu kapat.
onAuthChange((session) => {
  if (!session) {
    stopApp()
    goster()
  }
})
goster()
