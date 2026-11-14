// Sağdaki üye paneli: "Çevrimiçi — N" ve "Çevrimdışı — N" olarak gruplanır.
// Roller (v0.11.0): çevrimiçiler en yüksek "ayrı göster" rolüne göre kendi başlığında ("Mod — 2");
// adlar en yüksek renkli rolün renginde (src/data/rolKurallari.js).
import { STATUS_COLORS } from '../presence/status.js'
import { uyeGruplari, kisiGorunumu } from '../data/rolKurallari.js'
import { avatarTextColor } from './avatarColor.js'
import { makeProfileOpener } from './profileOpener.js'

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
  av.style.color = avatarTextColor(kisi.color)
  // Çevrimdışıda yalnız avatar soluklaşır (.dim); durum noktası ve ad solmaz
  if (status === 'offline') av.classList.add('dim')
  kutu.append(av, statusDot(status))
  return kutu
}

// members: profil dizisi; presence: Map<userId, {status, statusText}>
// roles, memberRoles (isteğe bağlı): sunucunun rolleri ve atamaları (yoksa eski gruplama)
export function renderMemberList(panel, { members, presence, roles = [], memberRoles = [] }) {
  // classList.add: app.js'in koyduğu .sunucusuz gibi sınıflar silinmesin (className = ... silerdi)
  panel.classList.add('member-panel')
  // Baştan çizim odaktaki avatarı siler: anahtarını (data-odak) hatırla, çizimden sonra yenisine odaklan.
  // Yalnız odak paneldeyse (başka yerdeki odağı çalmayız).
  const odakli = document.activeElement
  const odakAnahtari = panel.contains(odakli) ? odakli.dataset?.odak : null
  panel.innerHTML = ''

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
      const renk = kisiGorunumu(roles, memberRoles, k.id).renk
      if (renk) ad.style.color = renk // tema değişkeni (var(--rol-...))
      metin.appendChild(ad)
      if (durum?.statusText) {
        const y = document.createElement('div')
        y.className = 'member-status-text'
        y.textContent = durum.statusText
        metin.appendChild(y)
      }
      // Avatara tıklayınca profil kartı açılır (dinleyici app.js'te: installProfileCards)
      const av = makeProfileOpener(avatarWithDot(k, durum?.status ?? 'offline'), k, `profil-uye-${k.id}`)
      satir.append(av, metin)
      panel.appendChild(satir)
    }
  }
  for (const g of uyeGruplari(members, (id) => presence.has(id), roles, memberRoles)) grup(g.baslik, g.kisiler)
  if (odakAnahtari) {
    // CSS seçicisi yerine tek tek karşılaştırma: anahtarda tırnak olsa da bozulmasın
    ;[...panel.querySelectorAll('[data-odak]')].find((e) => e.dataset.odak === odakAnahtari)?.focus()
  }
}
