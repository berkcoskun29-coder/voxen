// Sağdaki üye paneli: "Çevrimiçi — N" ve "Çevrimdışı — N" olarak gruplanır.
import { STATUS_COLORS } from '../presence/status.js'

// Renkli durum noktası (avatarın köşesine konur)
export function statusDot(status) {
  const nokta = document.createElement('span')
  nokta.className = 'status-dot'
  nokta.dataset.status = status
  nokta.style.background = STATUS_COLORS[status] ?? STATUS_COLORS.offline
  return nokta
}

// Avatar (resim ya da renkli baş harf) + durum noktası
export function avatarWithDot(kisi, status, sinif = 'member-avatar') {
  const kutu = document.createElement('span')
  kutu.className = 'avatar-wrap'
  let av
  if (kisi.avatar_url) {
    av = document.createElement('img')
    av.src = kisi.avatar_url
    av.alt = ''
  } else {
    av = document.createElement('span')
    av.textContent = (Array.from(kisi.username)[0] ?? '?').toLocaleUpperCase('tr')
  }
  av.className = sinif
  av.style.background = kisi.color
  kutu.append(av, statusDot(status))
  return kutu
}

// members: profil dizisi; presence: Map<userId, {status, statusText}>
export function renderMemberList(panel, { members, presence }) {
  panel.className = 'member-panel'
  panel.innerHTML = ''
  const cevrimici = members.filter((m) => presence.has(m.id))
  const cevrimdisi = members.filter((m) => !presence.has(m.id))

  function grup(baslik, kisiler) {
    if (kisiler.length === 0) return
    const b = document.createElement('div')
    b.className = 'section-title member-group-title'
    b.textContent = `${baslik} — ${kisiler.length}`
    panel.appendChild(b)
    for (const k of kisiler) {
      const durum = presence.get(k.id)
      const satir = document.createElement('div')
      satir.className = 'member-row' + (durum ? '' : ' offline')
      const metin = document.createElement('div')
      metin.className = 'member-text'
      const ad = document.createElement('div')
      ad.className = 'member-name'
      ad.textContent = k.username
      metin.appendChild(ad)
      if (durum?.statusText) {
        const y = document.createElement('div')
        y.className = 'member-status-text'
        y.textContent = durum.statusText
        metin.appendChild(y)
      }
      satir.append(avatarWithDot(k, durum?.status ?? 'offline'), metin)
      panel.appendChild(satir)
    }
  }
  grup('Çevrimiçi', cevrimici)
  grup('Çevrimdışı', cevrimdisi)
}
