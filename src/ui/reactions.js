// Emoji tepkileri arayüzü: mesajın altındaki rozetler ve 😊 ile açılan 8 emojilik seçici.
// Bu dosya yalnız DOM kurar; veri işlerini chatView.js yapar. Kullanıcı adı hep textContent ile yazılır.
import { EMOJILER } from '../data/reactions.js'

// İpucu metni: en fazla 3 ad, kalanlar "ve N kişi daha". Adı bilinmeyen (profili gelmemiş) kişi sayıya katılır.
//   ['berk'] -> "berk"; ['berk','ayla'] -> "berk ve ayla"; 3 ad -> "berk, ayla ve can"
//   5 kişi -> "berk, ayla, can ve 2 kişi daha"; ['berk','ayla',null] -> "berk, ayla ve 1 kişi daha"
export function tepkiIpucu(adlar) {
  const bilinen = adlar.filter((a) => a)
  const gorunen = bilinen.slice(0, 3)
  const kalan = adlar.length - gorunen.length
  if (gorunen.length === 0) return `${kalan} kişi`
  if (kalan > 0) return `${gorunen.join(', ')} ve ${kalan} kişi daha`
  if (gorunen.length === 1) return gorunen[0]
  return `${gorunen.slice(0, -1).join(', ')} ve ${gorunen.at(-1)}`
}

// Mesajın altındaki rozet satırı. ozet: [{ emoji, adlar: [ad|null], benim: bool }] (EMOJILER sırasıyla).
// aktif: tıklanabilir mi (engelli DM'de rozet görünür ama pasif). onToggle(emoji, ekle).
// Boşsa null döner.
export function tepkiRozetleri(ozet, { aktif = true, onToggle } = {}) {
  if (!ozet?.length) return null
  const satir = document.createElement('div')
  satir.className = 'msg-reactions'
  for (const t of ozet) {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'reaction' + (t.benim ? ' mine' : '')
    b.dataset.emoji = t.emoji
    b.setAttribute('aria-pressed', String(!!t.benim))
    const kim = tepkiIpucu(t.adlar)
    b.dataset.tip = kim
    b.setAttribute('aria-label', `${t.emoji} tepkisi, ${t.adlar.length} kişi: ${kim}`)
    const e = document.createElement('span')
    e.className = 'reaction-emoji'
    e.textContent = t.emoji
    const n = document.createElement('span')
    n.className = 'reaction-count'
    n.textContent = String(t.adlar.length)
    b.append(e, n)
    if (aktif) b.onclick = () => onToggle?.(t.emoji, !t.benim)
    else { b.disabled = true; b.setAttribute('aria-disabled', 'true') }
    satir.appendChild(b)
  }
  return satir
}

let acikSecici = null // aynı anda tek seçici

// 😊 düğmesinin yanında 8 emojilik kutu açar (sayfanın üstünde, position: fixed).
// Klavye: ok tuşları / Home / End gezinir, Enter-boşluk seçer (düğme), Esc kapatır ve odak düğmeye döner.
// Dışarı tıklamak da kapatır. onSec(emoji) seçimde çağrılır (kutu kapanır).
// donusOdagi(): kapanınca odağın döneceği öğe (çapa yeniden çizilmiş olabilir). Dönen: { el, kapat }
export function tepkiSecici(capa, { onSec, donusOdagi = () => capa } = {}) {
  acikSecici?.kapat(false)
  const kutu = document.createElement('div')
  kutu.className = 'reaction-picker'
  kutu.setAttribute('role', 'dialog')
  kutu.setAttribute('aria-label', 'Tepki seç')
  const dugmeler = EMOJILER.map((emoji, i) => {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'reaction-choice'
    b.dataset.emoji = emoji
    b.setAttribute('aria-label', `${emoji} tepkisi ver`)
    b.textContent = emoji
    b.tabIndex = i === 0 ? 0 : -1 // gezinen tek durak (ok tuşlarıyla dolaşılır)
    b.onclick = () => { kapat(true); onSec?.(emoji) }
    return b
  })
  kutu.append(...dugmeler)
  document.body.appendChild(kutu)

  // Konum: çapanın üstünde, sağa yaslı (ekrandan taşmasın)
  const r = capa.getBoundingClientRect?.() ?? { top: 0, right: 0, bottom: 0 }
  kutu.style.top = Math.max(8, r.top - 48) + 'px'
  kutu.style.left = Math.max(8, r.right - 8 * 40) + 'px'

  const odakla = (i) => {
    const n = (i + dugmeler.length) % dugmeler.length
    dugmeler.forEach((b, j) => { b.tabIndex = j === n ? 0 : -1 })
    dugmeler[n].focus()
  }
  kutu.addEventListener('keydown', (e) => {
    const simdi = dugmeler.indexOf(document.activeElement)
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); kapat(true) }
    else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); odakla(simdi + 1) }
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); odakla(simdi - 1) }
    else if (e.key === 'Home') { e.preventDefault(); odakla(0) }
    else if (e.key === 'End') { e.preventDefault(); odakla(dugmeler.length - 1) }
    else if (e.key === 'Tab') { e.preventDefault(); kapat(true) } // kutudan çıkış: çapaya dön
  })
  const disari = (e) => { if (!kutu.contains(e.target) && e.target !== capa) kapat(false) }
  document.addEventListener('mousedown', disari, true)

  let kapandi = false
  function kapat(odakVer) {
    if (kapandi) return
    kapandi = true
    document.removeEventListener('mousedown', disari, true)
    kutu.remove()
    if (acikSecici === kayit) acikSecici = null
    if (odakVer) donusOdagi()?.focus?.()
  }
  const kayit = { el: kutu, kapat }
  acikSecici = kayit
  dugmeler[0].focus()
  return kayit
}
