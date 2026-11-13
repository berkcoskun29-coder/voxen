// Alttaki ses paneli (kullanıcı çubuğunun hemen üstünde):
// üstte "Ses bağlandı · kanal" satırı + kare Ayrıl düğmesi, varsa hata yazıları,
// altta yalnız simgeli Kamera / Ekran düğmeleri (adları baloncukta).
// Sustur / Sağırlaştır artık kullanıcı çubuğunda (renderMuteButtons; bkz. channelList.js).

export const VOICE_STATUS_TEXT = {
  connecting: 'Bağlanıyor…',
  connected: 'Ses bağlandı',
  failed: 'Doğrudan bağlantı kurulamadı',
}

import { micIcon, headphonesIcon, cameraIcon, screenIcon, hangupIcon } from './icons.js'
import { screenShareSupported, desktopScreenNotice } from '../voice/screenShare.js'
import { isTauri } from '../desktop.js'

// ad: düğmenin kısa adı (data-ad; testler ve kod buradan bulur). Düğmede yazı yok, yalnız simge var:
// aria: ekran okuyucu metni; aynı metin title ve data-tip olarak baloncukta (src/ui/tooltip.js) görünür.
function dugme(ad, basili, onClick, ek = '', simge = null, aria = '') {
  const b = document.createElement('button')
  b.type = 'button'
  b.className = 'voice-btn' + (basili ? ' active' : '') + ek
  b.dataset.ad = ad
  b.dataset.odak = `ses-${ad}` // panel yeniden çizilince odak bu anahtarla geri gelir (channelList.js)
  if (simge) b.appendChild(simge)
  if (aria) { b.setAttribute('aria-label', aria); b.title = aria; b.dataset.tip = aria }
  b.setAttribute('aria-pressed', String(!!basili))
  b.onclick = () => { if (!b.dataset.pasif) onClick?.() }
  return b
}

// Pasif düğme: disabled yerine aria-disabled; böylece odaklanabilir, baloncuğu görünür, tıklama boşa gider.
// neden: baloncukta (ve title'da) adın yerine görünen açıklama, ör. "Bağlanırken kullanılamaz".
// Düğmenin adı aria-label'da kalır; ekran okuyucu "Kamerayı aç, kullanılamaz" der.
function pasifYap(b, pasif, neden) {
  if (!pasif) return
  b.dataset.pasif = '1' // tıklama boşa gider
  b.setAttribute('aria-disabled', 'true')
  b.classList.add('unavailable') // CSS: soluk
  b.dataset.tip = neden
  b.title = neden
}

// Kullanıcı çubuğundaki Sustur ve Sağırlaştır simge düğmeleri.
// durum: { muted, deafened, listenOnly } — sesli kanaldaysak oturumun durumu, değilsek kayıtlı tercih.
// handlers: onToggleMute(), onToggleDeafen(). Basılıyken kırmızı (.active) ve çizili simge.
// Odak anahtarları (data-odak: ses-Sustur / ses-Sağırlaştır) yeniden çizimde odağı geri getirir.
export function renderMuteButtons(durum, handlers = {}) {
  // Sağırlaştırma susturmayı da getirir: mikrofon simgesi sağırken de çizili görünür
  const miksiz = durum.muted || durum.deafened
  const sustur = dugme('Sustur', durum.muted, handlers.onToggleMute, ' bar-btn', micIcon(miksiz, 18), durum.muted ? 'Mikrofonu aç' : 'Mikrofonu kapat')
  sustur.setAttribute('aria-label', 'Sustur') // ad sabit kalır; durumu aria-pressed söyler (değişen yazı yalnız baloncukta)
  pasifYap(sustur, durum.listenOnly, 'Mikrofon yok') // mikrofon yoksa açılamaz
  const sagir = dugme('Sağırlaştır', durum.deafened, handlers.onToggleDeafen, ' bar-btn', headphonesIcon(durum.deafened, 18), durum.deafened ? 'Sesi aç' : 'Sesi kapat')
  sagir.setAttribute('aria-label', 'Sağırlaştır')
  return [sustur, sagir]
}

// DM aramasındayken kullanıcı çubuğunun üstündeki satır: "Aramada · Ad" (tıklayınca o DM açılır) + Kapat.
// Ses panelinin üst satırıyla aynı görünüm (voice-panel / voice-top).
// video: { camera, screen } -> açıksa satırda yeşil "Kamerayı kapat" / "Paylaşımı durdur" düğmesi çıkar:
// DM'den ayrılınca da görüntümüzün açık olduğu görünür ve buradan kapatılabilir.
// handlers: onOpen(), onHangup(), onToggleCamera(), onToggleScreen()
export function renderCallRow({ peerName, video = {}, handlers = {} }) {
  const kutu = document.createElement('div')
  kutu.className = 'call-row'
  const ust = document.createElement('div')
  ust.className = 'voice-top'
  const ac = document.createElement('button')
  ac.type = 'button'
  ac.className = 'voice-info call-open'
  ac.dataset.odak = 'arama-ac'
  const durum = document.createElement('span')
  durum.className = 'voice-status connected'
  durum.textContent = 'Aramada'
  const ad = document.createElement('span')
  ad.className = 'voice-channel-name'
  ad.textContent = peerName
  ac.append(durum, ' · ', ad)
  ac.onclick = () => handlers.onOpen?.()
  ust.appendChild(ac)
  if (video.camera) ust.appendChild(dugme('Kamera', true, handlers.onToggleCamera, ' camera-btn', cameraIcon(false, 18), 'Kamerayı kapat'))
  if (video.screen) ust.appendChild(dugme('Ekran', true, handlers.onToggleScreen, ' camera-btn screen-btn', screenIcon(18), 'Paylaşımı durdur'))
  const kapat = dugme('Kapat', false, handlers.onHangup, ' leave', hangupIcon(), 'Kapat')
  ust.appendChild(kapat)
  kutu.appendChild(ust)
  return kutu
}

// state: createVoiceSession().getState()
// handlers: onToggleCamera(), onToggleScreen(), onLeave()  pttHint: varsa kırmızı ipucu yazısı
export function renderVoicePanel({ channelName, state, handlers, pttHint }) {
  const kutu = document.createElement('div')
  kutu.className = 'voice-panel'

  // Üst satır: "Ses bağlandı · Lobi" (solda) ve kare Ayrıl düğmesi (sağda)
  const ust = document.createElement('div')
  ust.className = 'voice-top'
  const bilgi = document.createElement('div')
  bilgi.className = 'voice-info'
  const durum = document.createElement('span')
  durum.className = 'voice-status ' + state.status // renk CSS'te: bağlandı yeşil, hata kırmızı
  durum.textContent = VOICE_STATUS_TEXT[state.status] ?? ''
  const ad = document.createElement('span')
  ad.className = 'voice-channel-name'
  ad.textContent = channelName
  bilgi.append(durum, ' · ', ad)
  const ayril = dugme('Ayrıl', false, handlers.onLeave, ' leave', hangupIcon(), 'Ayrıl')
  ust.append(bilgi, ayril)
  kutu.appendChild(ust)

  for (const metin of [state.micError, state.cameraError, state.screenError]) {
    if (!metin) continue
    const hata = document.createElement('div')
    hata.className = 'voice-error'
    hata.textContent = metin
    kutu.appendChild(hata)
  }

  // Bas-konuş modunda tuş seçilmemişse kapı kapalı kalır; kullanıcıya söyle
  if (pttHint) {
    const ip = document.createElement('div')
    ip.className = 'voice-error'
    ip.textContent = pttHint
    kutu.appendChild(ip)
  }

  const dugmeler = document.createElement('div')
  dugmeler.className = 'voice-buttons'
  // Kamera: açıkken yeşil (active), yalnız simge
  const kamera = dugme('Kamera', state.camera, handlers.onToggleCamera, ' camera-btn', cameraIcon(false, 18), state.camera ? 'Kamerayı kapat' : 'Kamerayı aç')
  // Bağlanırken kamera/ekran açılamaz (örgü henüz kurulmadı): düğmeler soluk ve tıklanamaz
  const baglaniyor = state.status === 'connecting'
  pasifYap(kamera, baglaniyor, 'Bağlanırken kullanılamaz')
  dugmeler.append(kamera)
  // Ekran paylaşımı: açıkken yeşil; tarayıcı desteklemiyorsa düğme hiç görünmez
  if (screenShareSupported()) {
    const ekran = dugme('Ekran', state.screen, handlers.onToggleScreen, ' camera-btn screen-btn', screenIcon(18), state.screen ? 'Paylaşımı durdur' : 'Ekranı paylaş')
    pasifYap(ekran, baglaniyor, 'Bağlanırken kullanılamaz')
    dugmeler.appendChild(ekran)
  } else if (isTauri()) {
    // Masaüstü programı ekran yakalamayı desteklemiyorsa düğme kalır ama soluk durur;
    // üstüne gelince ipucu, tıklayınca panelde uyarı: "Bu özellik şimdilik tarayıcı sürümünde: …"
    const not = desktopScreenNotice()
    const b = dugme('Ekran', false, () => {
      if (kutu.querySelector('.screen-notice')) return // bir kez yeter
      const uyari = document.createElement('div')
      uyari.className = 'voice-error screen-notice'
      uyari.textContent = not
      kutu.insertBefore(uyari, dugmeler)
    }, ' camera-btn screen-btn unavailable', screenIcon(18), not)
    b.setAttribute('aria-disabled', 'true') // disabled değil: ipucu ve tıklama çalışsın diye
    dugmeler.appendChild(b)
  }
  kutu.appendChild(dugmeler)
  return kutu
}
