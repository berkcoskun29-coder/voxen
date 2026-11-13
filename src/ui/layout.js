// Ana düzen: solda sunucu şeridi (72px), kanal paneli (240px), esnek ana alan, sağda üye paneli (240px).
import { createModalShell } from './modal.js'
import { usersIcon } from './icons.js'

// root'un içine üç bölümü kurar ve düğümleri döner.
export function mountLayout(root) {
  root.innerHTML = ''
  const rail = document.createElement('nav')
  rail.className = 'server-rail'
  const channels = document.createElement('aside')
  channels.className = 'channel-panel'
  const main = document.createElement('main')
  main.className = 'main-area'
  const members = document.createElement('aside')
  members.className = 'member-panel'
  members.id = 'uye-paneli' // "Üyeler" düğmesi aria-controls ile bu paneli gösterir
  root.append(rail, channels, main, members)
  return { rail, channels, main, members }
}

// ---- "Üyeler" düğmesi: sağdaki üye panelini açar / kapatır ----
// Seçim tarayıcıda hatırlanır ('1' açık, '0' kapalı). Hiç seçim yapılmadıysa pencere genişliği
// karar verir: 1100px'ten darsa panel kapalı (sohbete yer kalsın), genişse açık.
const UYE_ANAHTARI = 'voxen.uyePaneli'
const DAR_PENCERE = 1100

function uyeSeciminiOku() {
  try {
    const v = localStorage.getItem(UYE_ANAHTARI)
    return v === '1' ? true : v === '0' ? false : null // null: henüz seçim yok
  } catch { return null } // tarayıcı depoyu engellediyse: seçim yokmuş gibi
}
function uyeSeciminiYaz(acik) {
  try { localStorage.setItem(UYE_ANAHTARI, acik ? '1' : '0') } catch { /* hatırlanmazsa sorun değil */ }
}

// panel: mountLayout'un döndüğü üye paneli. Dönen: { button, refresh(), dispose() }.
// button sohbet başlığına konur (chatView headerActions). dispose() pencere dinleyicisini bırakır.
export function createMemberToggle(panel) {
  const dugme = document.createElement('button')
  dugme.type = 'button'
  dugme.className = 'icon-btn members-toggle'
  dugme.dataset.tip = 'Üyeler'
  dugme.dataset.tipSide = 'bottom' // başlık ekranın tepesinde: baloncuk altta çıksın
  dugme.setAttribute('aria-label', 'Üyeler')
  dugme.setAttribute('aria-controls', panel.id)
  dugme.appendChild(usersIcon())

  // Paneli göster/gizle; düğmenin basılı görünümü (aria-pressed) panelle aynı olsun
  function uygula(acik) {
    panel.hidden = !acik
    dugme.setAttribute('aria-pressed', String(acik))
  }
  const genisMi = () => window.innerWidth >= DAR_PENCERE
  uygula(uyeSeciminiOku() ?? genisMi())

  dugme.onclick = () => {
    const acik = panel.hidden // şu an gizliyse açılacak
    uyeSeciminiYaz(acik)
    uygula(acik)
  }
  // Seçim yapılmadıysa pencere boyutu değişince varsayılanı yeniden uygula
  const boyutDegisti = () => { if (uyeSeciminiOku() === null) uygula(genisMi()) }
  window.addEventListener('resize', boyutDegisti)
  return {
    button: dugme,
    // Panel başka biri tarafından gösterildiyse (DM'de profil kartı) seçime göre yeniden uygula
    refresh: () => uygula(uyeSeciminiOku() ?? genisMi()),
    dispose: () => window.removeEventListener('resize', boyutDegisti),
  }
}

// Sağ altta kısa süre görünen bildirim.
// tur: 'bilgi' (varsayılan) | 'basari' | 'hata'. Renkli şerit ve simge CSS'ten gelir (.toast-basari vb.).
// Bütün bildirimler tek sabit kutuda (.toast-stack) alt alta dizilir: üst üste binmezler.
// Bilgi ve başarı 4 sn, hata 6 sn kalır (hata × düğmesiyle de kapatılır).
const TOAST_TURLERI = ['bilgi', 'basari', 'hata']
const TOAST_EN_FAZLA = 4 // aynı anda görünen en çok bildirim
const TOAST_SURE = 4000
const TOAST_HATA_SURE = 6000
let toastKutusu = null
// Gelen arama kartı da bu kutuya (bildirimlerin üstüne) konur: src/ui/incomingCall.js
export function toastKutusunuAl() {
  // Sayfa yeniden kurulduysa (kutu belgeden çıktıysa) yenisini kur
  if (!toastKutusu?.isConnected) {
    toastKutusu = document.createElement('div')
    toastKutusu.className = 'toast-stack'
    toastKutusu.setAttribute('aria-live', 'polite') // ekran okuyucu nazikçe duyurur (hatalar role=alert)
    document.body.appendChild(toastKutusu)
  }
  return toastKutusu
}
export function toast(mesaj, tur = 'bilgi') {
  if (!TOAST_TURLERI.includes(tur)) tur = 'bilgi'
  const el = document.createElement('div')
  el.className = `toast toast-${tur}`
  el.setAttribute('role', tur === 'hata' ? 'alert' : 'status') // ekran okuyucu hatayı hemen okusun
  el.textContent = mesaj // metin olarak yazılır, HTML çalışmaz
  if (tur === 'hata') {
    // × simgesi CSS'ten gelir (::before), böylece textContent yalnız mesaj kalır
    const kapat = document.createElement('button')
    kapat.type = 'button'
    kapat.className = 'toast-kapat'
    kapat.setAttribute('aria-label', 'Bildirimi kapat')
    kapat.onclick = () => el.remove()
    el.appendChild(kapat)
  }
  const kutu = toastKutusunuAl()
  kutu.appendChild(el) // en yenisi en altta
  // Fazlalık varsa en eski hata olmayan bildirim düşer; hata, okunmadan yenilerce itilmesin
  // Yalnız bildirimler sayılır (kutudaki gelen arama kartı sayılmaz, düşürülmez)
  const bildirimler = () => [...kutu.children].filter((c) => c.classList.contains('toast'))
  while (bildirimler().length > TOAST_EN_FAZLA) {
    const hepsi = bildirimler()
    const eski = hepsi.find((c) => !c.classList.contains('toast-hata')) ?? hepsi[0]
    eski.remove()
  }
  setTimeout(() => el.remove(), tur === 'hata' ? TOAST_HATA_SURE : TOAST_SURE)
}

// Küçük pencere (sunucu oluştur, kanal ekle, sunucuya katıl): ortak kalıbı kullanır (modal.js).
// alanlar: HTMLElement dizisi. onSubmit() hata metni dönerse pencere açık kalır, null dönerse kapanır.
// Yazı kutusundayken Enter de ana düğmeye basar.
export function openModal(baslik, alanlar, onSubmit, kaydetYazisi = 'Oluştur') {
  const { arka } = createModalShell({ baslik, govde: alanlar, birincil: { yazi: kaydetYazisi, tik: onSubmit }, enterIleKaydet: true })
  return arka
}
