// Soldaki sunucu şeridi: her sunucu için ilk harfli simge ve en altta "+".

// Sunucu adının ilk harfi, büyük (Türkçe kurallarıyla: i -> İ)
export function ilkHarf(ad) {
  return (Array.from(ad.trim())[0] ?? '?').toLocaleUpperCase('tr')
}

import { plusIcon, linkIcon } from './icons.js'
import { sayiYazisi } from './unread.js'

// Her şerit düğmesi: ad hem ekran okuyucuya (aria-label) hem baloncuğa (data-tip + title) gider.
// Baloncuğu src/ui/tooltip.js gösterir.
function ipucuVer(dugme, ad) {
  dugme.title = ad
  dugme.dataset.tip = ad
  dugme.dataset.tipSide = 'right' // şeritte baloncuk sağda çıkar
  dugme.setAttribute('aria-label', ad)
}

// unread: { serverCount(serverId) } (isteğe bağlı): okunmamışı olan sunucuda solda nokta + sağ altta sayı.
// handlers: { onSelect(serverId), onAdd(), onJoin() }
export function renderRail(rail, servers, selectedId, handlers, unread = null) {
  // Okunmamış değişince şerit baştan çizilir: odaktaki düğme silinip klavye odağı kaybolmasın diye
  // önce anahtarını (data-odak, bkz. channelList.js) hatırla, çizimden sonra aynı anahtarlıya odaklan.
  const odakli = document.activeElement
  const odakAnahtari = rail.contains(odakli) ? odakli.dataset?.odak : null
  rail.innerHTML = ''
  for (const s of servers) {
    const dugme = document.createElement('button')
    dugme.type = 'button'
    dugme.className = 'server-icon' + (s.id === selectedId ? ' selected' : '')
    ipucuVer(dugme, s.name)
    dugme.dataset.odak = 'sunucu-' + s.id
    dugme.textContent = ilkHarf(s.name)
    const okunmamis = unread?.serverCount?.(s.id) ?? 0
    if (okunmamis > 0) {
      // Seçili sunucuda da görünür (başka kanallarında okunmamış olabilir)
      const nokta = document.createElement('span')
      nokta.className = 'server-unread-dot'
      const rozet = document.createElement('span')
      rozet.className = 'unread-badge'
      rozet.textContent = sayiYazisi(okunmamis)
      dugme.append(nokta, rozet)
      dugme.setAttribute('aria-label', `${s.name}, ${sayiYazisi(okunmamis)} okunmamış mesaj`)
    }
    dugme.onclick = () => handlers.onSelect?.(s.id)
    rail.appendChild(dugme)
  }
  // Sunucular ile eylem düğmeleri arasında ince ayraç (hiç sunucu yoksa ayıracak bir şey yok: çizilmez)
  if (servers.length > 0) {
    const ayrac = document.createElement('div')
    ayrac.className = 'rail-separator'
    ayrac.setAttribute('role', 'separator')
    rail.appendChild(ayrac)
  }

  const ekle = document.createElement('button')
  ekle.type = 'button'
  ekle.className = 'server-icon add'
  ipucuVer(ekle, 'Sunucu oluştur')
  ekle.dataset.odak = 'sunucu-ekle'
  ekle.appendChild(plusIcon())
  ekle.onclick = () => handlers.onAdd?.()
  rail.appendChild(ekle)
  const katil = document.createElement('button')
  katil.type = 'button'
  katil.className = 'server-icon join'
  ipucuVer(katil, 'Sunucuya katıl')
  katil.dataset.odak = 'sunucu-katil'
  katil.appendChild(linkIcon())
  katil.onclick = () => handlers.onJoin?.()
  rail.appendChild(katil)
  if (odakAnahtari) [...rail.querySelectorAll('[data-odak]')].find((e) => e.dataset.odak === odakAnahtari)?.focus()
}
