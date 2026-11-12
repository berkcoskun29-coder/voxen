// Alttaki ses paneli (kullanıcı çubuğunun hemen üstünde):
// bağlantı durumu, kanal adı, varsa mikrofon hatası ve Sustur / Sağırlaştır / Ayrıl düğmeleri.

export const VOICE_STATUS_TEXT = {
  connecting: 'Bağlanıyor…',
  connected: 'Bağlandı',
  failed: 'Doğrudan bağlantı kurulamadı',
}

import { micIcon, headphonesIcon } from './icons.js'

// simge: SVG (ya da yok); aria: ekran okuyucu/ipucu metni. Yazı da durur, simge yanına eklenir.
function dugme(yazi, basili, onClick, ek = '', simge = null, aria = '') {
  const b = document.createElement('button')
  b.type = 'button'
  b.className = 'voice-btn' + (basili ? ' active' : '') + ek
  if (simge) b.appendChild(simge)
  b.appendChild(document.createTextNode(yazi))
  if (aria) { b.setAttribute('aria-label', aria); b.title = aria }
  b.setAttribute('aria-pressed', String(!!basili))
  b.onclick = () => onClick?.()
  return b
}

// state: createVoiceSession().getState()
// handlers: onToggleMute(), onToggleDeafen(), onLeave()  pttHint: varsa kırmızı ipucu yazısı
export function renderVoicePanel({ channelName, state, handlers, pttHint }) {
  const kutu = document.createElement('div')
  kutu.className = 'voice-panel'

  const durum = document.createElement('div')
  durum.className = 'voice-status ' + state.status // renk CSS'te: bağlandı yeşil, hata kırmızı
  durum.textContent = VOICE_STATUS_TEXT[state.status] ?? ''

  const ad = document.createElement('div')
  ad.className = 'voice-channel-name'
  ad.textContent = channelName

  kutu.append(durum, ad)

  if (state.micError) {
    const hata = document.createElement('div')
    hata.className = 'voice-error'
    hata.textContent = state.micError
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
  // Sağırlaştırma susturmayı da getirir: mikrofon simgesi sağırken de çizili görünür
  const miksiz = state.muted || state.deafened
  const sustur = dugme('Sustur', state.muted, handlers.onToggleMute, '', micIcon(miksiz), state.muted ? 'Mikrofonu aç' : 'Mikrofonu kapat')
  sustur.disabled = !!state.listenOnly // mikrofon yoksa açılamaz
  const sagir = dugme('Sağırlaştır', state.deafened, handlers.onToggleDeafen, '', headphonesIcon(state.deafened), state.deafened ? 'Sesi aç' : 'Sesi kapat')
  const ayril = dugme('Ayrıl', false, handlers.onLeave, ' leave')
  dugmeler.append(sustur, sagir, ayril)
  kutu.appendChild(dugmeler)
  return kutu
}
