// Uygulamanın başlangıcı: oturuma göre doğru ekranı gösterir.
import './styles/theme.css'
import { getSession, getMyProfile, onAuthChange, signOut } from './auth/auth.js'
import { renderAuthView, renderNewPasswordView } from './auth/authView.js'
import { renderCompleteProfile } from './auth/profileModal.js'
import { isRecoveryPending, markRecoveryPending, clearRecoveryPending, takeRecoveryLinkError } from './auth/recovery.js'
import { startApp, stopApp } from './ui/app.js'
import { installTooltips } from './ui/tooltip.js'
import { toast } from './ui/layout.js'
import { inviteFromHash, storePendingInvite } from './ui/invite.js'

const app = document.querySelector('#app')
const LINK_GECERSIZ = 'Bu bağlantının süresi dolmuş ya da geçersiz. Yeni bir bağlantı iste.'

let yeniSifreAcik = false // "Yeni şifre belirle" formu ekranda mı (iki kez çizilip yazılanlar kaybolmasın)

// mesaj: (varsa) "Profilini tamamla" ekranında gösterilecek hata
async function goster(mesaj) {
  const session = await getSession()

  // Sıfırlama linkinden dönüldü: yeni şifre koymadan uygulamaya geçilmez
  if (isRecoveryPending()) {
    if (session) return yeniSifreyiGoster()
    clearRecoveryPending() // linkin oturumu yok (süresi dolmuş): yeni link istesin
    return renderAuthView(app, goster, { mod: 'unuttum', mesaj: LINK_GECERSIZ })
  }

  if (!session) {
    // Giriş yoksa ve adreste davet kodu varsa, girişten sonra kullanmak için sakla
    const davet = inviteFromHash()
    if (davet) storePendingInvite(davet)
    // Süresi dolmuş bir linkten gelindiyse doğrudan "Şifremi unuttum" formu, açıklamasıyla
    const linkHatasi = takeRecoveryLinkError()
    return renderAuthView(app, goster, linkHatasi ? { mod: 'unuttum', mesaj: linkHatasi } : undefined) // oturum yok → giriş ekranı
  }

  const profil = await getMyProfile(session.user.id)
  // Beklerken sıfırlama olayı geldiyse (PASSWORD_RECOVERY) yeni şifre formunun üstüne uygulama açılmasın
  if (yeniSifreAcik) return
  if (!profil) return renderCompleteProfile(app, session.user.id, goster, typeof mesaj === 'string' ? mesaj : '') // profil yok → tamamla

  installTooltips() // şerit ve ses paneli baloncukları (bir kez kurulur)
  startApp(app, profil, { email: session.user.email ?? '' }) // gerçek düzen: sunucular, kanallar
}

// Yeni şifre formu: uygulama açıksa önce durdurulur (sesli kanal, mikrofon, varlık)
function yeniSifreyiGoster() {
  if (yeniSifreAcik) return
  yeniSifreAcik = true
  stopApp()
  renderNewPasswordView(app, {
    onDone: () => {
      clearRecoveryPending()
      yeniSifreAcik = false
      toast('Şifren değiştirildi.', 'basari')
      goster()
    },
    onCikis: () => signOut(), // oturum kapanınca aşağıdaki dinleyici giriş ekranını açar
  })
}

// Oturum bitince (Çıkış, başka sekmede çıkış, süresi dolan oturum) giriş ekranına dön.
// Önce uygulamayı durdur: sesli kanaldan ayrıl, mikrofonu, varlığı ve bas-konuşu kapat.
// PASSWORD_RECOVERY: sıfırlama linkinden dönüldü → yeni şifre formu.
onAuthChange((session, olay) => {
  if (olay === 'PASSWORD_RECOVERY') {
    markRecoveryPending()
    yeniSifreyiGoster()
    return
  }
  if (!session) {
    clearRecoveryPending()
    yeniSifreAcik = false
    stopApp()
    goster()
  }
})
goster()
