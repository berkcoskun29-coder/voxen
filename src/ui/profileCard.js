// Küçük profil kartı: bir avatara (üye listesi, sohbet, sesli kanaldakiler) tıklayınca açılır.
//
//   ┌──────────────────────┐
//   │ (renkli şerit)       │
//   │  (A)● büyük avatar   │
//   │  ali                 │  .profile-card-name
//   │  ● Çevrimiçi         │  durum noktası + durum adı
//   │  Akşam 21.00 Lobi    │  durum yazısı (varsa)
//   │  Sesli kanalda: Lobi │  (varsa)
//   └──────────────────────┘
//
// Aynı anda tek kart. Esc, dışarı tıklama, sayfa kayması ya da pencere boyutu değişince kapanır.
// Açılınca odak karta girer; Esc ile kapanınca odak açan öğeye döner.
// Kullanıcı yazıları her zaman textContent ile basılır (HTML çalışmaz).
import { avatarWithDot, statusDot } from './memberList.js'
import { profileOpenerPerson } from './profileOpener.js'

export { makeProfileOpener } from './profileOpener.js'

// Durum adları (kartta noktanın yanında)
export const STATUS_LABELS = {
  online: 'Çevrimiçi',
  idle: 'Boşta',
  dnd: 'Rahatsız etmeyin',
  offline: 'Çevrimdışı',
}

const KENAR = 8 // ekran kenarına en az bu kadar boşluk
const ARALIK = 8 // tıklanan öğe ile kart arası

// Kartın yeri: tıklanan öğenin sağında (yer yoksa solunda), üst kenarı hizalı.
// Her durumda ekranın içinde kalır (alttan taşacaksa yukarı kayar).
// r: tıklanan öğenin getBoundingClientRect'i, boyut: { width, height } kartın, pencere: { width, height }
export function profileCardPosition(r, boyut, pencere) {
  let left = r.right + ARALIK
  if (left + boyut.width > pencere.width - KENAR) left = r.left - ARALIK - boyut.width
  left = Math.max(KENAR, Math.min(left, pencere.width - boyut.width - KENAR))
  const top = Math.max(KENAR, Math.min(r.top, pencere.height - boyut.height - KENAR))
  return { left, top }
}

let acik = null // { kart, acan, birak() } açık kart (en fazla bir tane)

// Açık kartı kapatır. returnFocus: odak açan öğeye dönsün mü (Esc ile kapanınca evet;
// dışarı tıklayınca hayır: odak tıklanan yere gider).
export function closeProfileCard({ returnFocus = false } = {}) {
  if (!acik) return
  const { kart, acan, birak } = acik
  acik = null
  birak()
  kart.remove()
  if (!returnFocus) return
  // Açan öğe bu arada yeniden çizildiyse (ör. üye listesi) aynı odak anahtarlı yeni öğeye dön
  let donulecek = acan
  const anahtar = acan?.dataset?.odak
  if (!donulecek?.isConnected && anahtar) {
    donulecek = [...document.querySelectorAll('[data-odak]')].find((e) => e.dataset.odak === anahtar)
  }
  if (donulecek?.isConnected) donulecek.focus()
}

// Açık kartın açanı (aynı avatara ikinci tıklama kartı kapatsın diye)
export function profileCardOpener() {
  return acik?.acan ?? null
}

function satir(sinif, metin) {
  const e = document.createElement('div')
  e.className = sinif
  e.textContent = metin
  return e
}

// Kendi kartımızın alt kısmı: durum seçimi (Çevrimiçi / Rahatsız etmeyin) ve "Profili düzenle".
// Seçim own.onStatus(dnd) ile yapılır; kart da hemen güncellenir (varlık dönüşünü beklemez).
function kendiBolumu(own, status, durumSatiri) {
  const kutu = document.createElement('div')
  kutu.className = 'profile-card-own'
  const grup = document.createElement('div')
  grup.className = 'profile-card-choices'
  grup.setAttribute('role', 'group')
  grup.setAttribute('aria-label', 'Durumun')
  const secenekler = [['online', false], ['dnd', true]].map(([d, dnd]) => {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'secondary profile-card-choice'
    b.dataset.durum = d
    b.textContent = STATUS_LABELS[d]
    b.onclick = () => {
      own.onStatus?.(dnd)
      isaretle(d)
    }
    grup.appendChild(b)
    return b
  })
  function isaretle(d) {
    for (const b of secenekler) b.setAttribute('aria-pressed', String(b.dataset.durum === d))
    const nokta = statusDot(d)
    nokta.classList.add('inline')
    durumSatiri.replaceChildren(nokta, STATUS_LABELS[d])
  }
  isaretle(status === 'dnd' ? 'dnd' : 'online') // otomatik "Boşta" da seçimde "Çevrimiçi" sayılır
  const duzenle = document.createElement('button')
  duzenle.type = 'button'
  duzenle.className = 'secondary profile-card-edit'
  duzenle.textContent = 'Profili düzenle'
  duzenle.onclick = () => {
    closeProfileCard({ returnFocus: true }) // odak açana dönsün; pencere kapanınca oraya geri gelir
    own.onEdit?.()
  }
  kutu.append(grup, duzenle)
  return kutu
}

// Başkasının kartında arkadaşlık ve mesaj düğmeleri (spec §1 "Profil kartı").
// social: { friend: 'friend' | 'outgoing' | 'none' | null, canMessage, onAdd() -> Promise<'sent'|'accepted'>, onMessage() }
//   friend 'none'    -> "Arkadaş ekle" (basınca istek gider; sonra "İstek gönderildi" olur)
//   friend 'outgoing'-> "İstek gönderildi" (pasif)
//   friend 'friend' ya da null (bilinmiyor) -> arkadaşlık düğmesi yok
//   canMessage       -> "Mesaj gönder" (arkadaşa da sunucu arkadaşına da)
function sosyalBolumu(social) {
  const kutu = document.createElement('div')
  kutu.className = 'profile-card-social'
  const hata = document.createElement('div')
  hata.className = 'profile-card-error'
  hata.setAttribute('role', 'alert')
  let mesaj = null

  function mesajDugmesi() {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'profile-card-message'
    b.textContent = 'Mesaj gönder'
    b.onclick = () => {
      closeProfileCard()
      social.onMessage?.()
    }
    return b
  }
  function gonderildi() {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'secondary profile-card-friend'
    b.textContent = 'İstek gönderildi'
    b.disabled = true
    return b
  }

  let arkadasDugmesi = null
  if (social.friend === 'outgoing') arkadasDugmesi = gonderildi()
  else if (social.friend === 'none') {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'secondary profile-card-friend'
    b.textContent = 'Arkadaş ekle'
    b.onclick = async () => {
      b.disabled = true
      hata.textContent = ''
      try {
        const r = await social.onAdd?.()
        if (r === 'accepted') {
          // İki istek eşleşti: artık arkadaşsınız; mesaj düğmesi yoksa eklenir
          b.remove()
          if (!mesaj) { mesaj = mesajDugmesi(); kutu.prepend(mesaj) }
        } else {
          b.replaceWith(gonderildi())
        }
      } catch (e) {
        hata.textContent = e?.message || 'Bir şeyler ters gitti. İnternetini kontrol edip tekrar dene.'
        b.disabled = false
      }
    }
    arkadasDugmesi = b
  }
  if (social.canMessage) { mesaj = mesajDugmesi(); kutu.appendChild(mesaj) }
  if (arkadasDugmesi) kutu.appendChild(arkadasDugmesi)
  kutu.appendChild(hata)
  return kutu
}

// person: profil { id, username, color, avatar_url }
// status: 'online' | 'idle' | 'dnd' | 'offline'; statusText: durum yazısı (boş olabilir)
// voiceChannelName: kişi bir sesli kanaldaysa kanalın adı (yoksa null)
// opener: tıklanan öğe (konum ve odak dönüşü için)
// own: yalnız KENDİ kartımızda: { onStatus(dnd), onEdit() }. Durum seçimi ve "Profili düzenle" düğmesi çıkar;
// seçimi yapan kod (tercihi yazıp varlığı yenilemek) app.js'tedir, kart yalnız çağırır.
// social: yalnız BAŞKASININ kartında: arkadaşlık / mesaj düğmeleri (bkz. sosyalBolumu).
export function openProfileCard({ person, status = 'offline', statusText = '', voiceChannelName = null, opener = null, own = null, social = null }) {
  closeProfileCard() // tek kart
  const kart = buildProfileCard({ person, status, statusText, voiceChannelName, own, social })
  kart.setAttribute('role', 'dialog')
  kart.tabIndex = -1
  document.body.appendChild(kart)
  baglaAcikKart(kart, opener)
  return kart
}

// Kartın kendisi (konumsuz, dinleyicisiz). openProfileCard açılır kart olarak kullanır;
// DM ekranında sağ panel aynı kartı sabit olarak gösterir (app.js, .member-panel içinde).
export function buildProfileCard({ person, status = 'offline', statusText = '', voiceChannelName = null, own = null, social = null }) {
  const kart = document.createElement('div')
  kart.className = 'profile-card'
  kart.setAttribute('aria-label', `${person.username} profili`)

  const serit = document.createElement('div')
  serit.className = 'profile-card-banner'
  serit.style.background = person.color // kişinin rengi (avatarla aynı)
  const govde = document.createElement('div')
  govde.className = 'profile-card-body'

  const av = avatarWithDot(person, status, 'profile-card-avatar')
  const durum = document.createElement('div')
  durum.className = 'profile-card-status'
  const nokta = statusDot(status)
  nokta.classList.add('inline') // köşede değil, yazının önünde
  durum.append(nokta, STATUS_LABELS[status] ?? STATUS_LABELS.offline)
  govde.append(av, satir('profile-card-name', person.username), durum)
  if (statusText) govde.appendChild(satir('profile-card-text', statusText))
  if (own) govde.appendChild(kendiBolumu(own, status, durum))
  if (voiceChannelName) govde.appendChild(satir('profile-card-voice', `Sesli kanalda: ${voiceChannelName}`))
  if (social && !own) govde.appendChild(sosyalBolumu(social))
  kart.append(serit, govde)
  return kart
}

// Açılır kartı konumlar ve kapanma yollarını bağlar (Esc, dışarı tıklama, boyut, odak çıkışı)
function baglaAcikKart(kart, opener) {
  // Konum: ekrana sığacak şekilde, tıklanan öğenin yanında
  const konumla = () => {
    const r = opener?.getBoundingClientRect?.() ?? { left: 0, right: 0, top: 0, bottom: 0 }
    const { left, top } = profileCardPosition(r, { width: kart.offsetWidth, height: kart.offsetHeight }, { width: window.innerWidth, height: window.innerHeight })
    kart.style.left = left + 'px'
    kart.style.top = top + 'px'
  }
  konumla()

  // Kapanma yolları
  const tus = (e) => {
    if (e.key !== 'Escape') return
    e.preventDefault()
    closeProfileCard({ returnFocus: true })
  }
  const basma = (e) => {
    if (kart.contains(e.target)) return
    if (opener && opener.contains(e.target)) return // aynı avatara tıklama: tıklama dinleyicisi kapatır
    closeProfileCard()
  }
  // Kaydırma kartı kapatmaz (sohbet kendiliğinden kayar): açan öğe sayfadaysa kart onunla birlikte
  // yer değiştirir; öğe sayfadan kalktıysa (liste yeniden çizildi) kart olduğu yerde kalır.
  const kayma = (e) => {
    if (e.target instanceof Node && kart.contains(e.target)) return
    if (opener?.isConnected) konumla()
  }
  const boyut = () => closeProfileCard()
  // Odak karttan başka bir yere giderse (Tab) kart kapanır
  const odakCikti = (e) => { if (e.relatedTarget && !kart.contains(e.relatedTarget)) closeProfileCard() }
  document.addEventListener('keydown', tus)
  document.addEventListener('mousedown', basma, true)
  window.addEventListener('scroll', kayma, true) // yakalama: içteki kaydırılan listeler de sayılır
  window.addEventListener('resize', boyut)
  kart.addEventListener('focusout', odakCikti)
  const birak = () => {
    document.removeEventListener('keydown', tus)
    document.removeEventListener('mousedown', basma, true)
    window.removeEventListener('scroll', kayma, true)
    window.removeEventListener('resize', boyut)
    kart.removeEventListener('focusout', odakCikti)
  }
  acik = { kart, acan: opener, birak }
  kart.focus()
}

// kok içindeki işaretli öğelere (makeProfileOpener) tıklanınca ya da Enter/Boşluk basılınca kartı açar.
// getInfo(kisi) -> { status, statusText, voiceChannelName, own?, social? }: güncel durum çizen yerden değil buradan gelir.
// Dönen fonksiyon dinleyicileri bırakır (ve açık kartı kapatır).
export function installProfileCards(kok, getInfo) {
  function ac(el) {
    if (acik && acik.acan === el) { closeProfileCard(); return } // ikinci tıklama kapatır
    const kisi = profileOpenerPerson(el)
    if (!kisi) return
    openProfileCard({ person: kisi, ...getInfo(kisi), opener: el })
  }
  const tik = (e) => {
    const el = e.target.closest?.('[data-profile-opener]')
    if (el && kok.contains(el)) ac(el)
  }
  const tus = (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return
    const el = e.target
    if (!el?.matches?.('[data-profile-opener]') || !kok.contains(el)) return
    e.preventDefault() // Boşluk sayfayı kaydırmasın
    ac(el)
  }
  kok.addEventListener('click', tik)
  kok.addEventListener('keydown', tus)
  return () => {
    kok.removeEventListener('click', tik)
    kok.removeEventListener('keydown', tus)
    closeProfileCard()
  }
}
