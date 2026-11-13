// Soldaki sunucu şeridi: en üstte Ana sayfa (verilirse) ve ayraç, sonra her sunucu için ilk harfli
// simge, en altta "+" ve "katıl".

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

// unread: { serverCount(serverId), serverMentions(serverId) } (isteğe bağlı): okunmamışı olan sunucuda solda nokta
// + sağ altta sayı; seni anan mesaj varsa sayının önünde "@".
// handlers: { onSelect(serverId), onAdd(), onJoin(), onHome() }
// home (isteğe bağlı): { selected, unread } -> en üstte Voxen logolu Ana sayfa düğmesi ve altında ayraç.
//   unread: okunmamış DM toplamı (sağ altta kırmızı rozet).
// muted (isteğe bağlı): Set<serverId> sessize alınan sunucular: simge soluk görünür, rozet yine çıkar.
export function renderRail(rail, servers, selectedId, handlers, unread = null, home = null, muted = null) {
  // Okunmamış değişince şerit baştan çizilir: odaktaki düğme silinip klavye odağı kaybolmasın diye
  // önce anahtarını (data-odak, bkz. channelList.js) hatırla, çizimden sonra aynı anahtarlıya odaklan.
  const odakli = document.activeElement
  const odakAnahtari = rail.contains(odakli) ? odakli.dataset?.odak : null
  rail.innerHTML = ''
  if (home) anaSayfaDugmesi(rail, home, handlers)
  for (const s of servers) {
    const dugme = document.createElement('button')
    dugme.type = 'button'
    const sessiz = !!muted?.has?.(s.id)
    dugme.className = 'server-icon' + (s.id === selectedId ? ' selected' : '') + (sessiz ? ' muted' : '')
    ipucuVer(dugme, s.name)
    if (sessiz) dugme.setAttribute('aria-label', `${s.name}, sessizde`)
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
      // Seni anan okunmamış mesaj varsa rozetin önünde küçük "@" işareti
      const anma = unread?.serverMentions?.(s.id) ?? 0
      if (anma > 0) {
        const isaret = document.createElement('span')
        isaret.className = 'mention-mark'
        isaret.setAttribute('aria-hidden', 'true') // bilgi aria-label'da
        isaret.textContent = '@'
        rozet.prepend(isaret)
      }
      dugme.append(nokta, rozet)
      dugme.setAttribute('aria-label', `${s.name}, ${sayiYazisi(okunmamis)} okunmamış mesaj` + (anma > 0 ? `, ${sayiYazisi(anma)} bahsetme` : '') + (sessiz ? ', sessizde' : ''))
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

// Ana sayfa düğmesi (Voxen logosu) + altında ince ayraç. Sınıfları sunucu simgesinden ayrı
// (.rail-home): sunucu simgelerini sayan/seçen kod onu sunucu sanmasın.
function anaSayfaDugmesi(rail, home, handlers) {
  const dugme = document.createElement('button')
  dugme.type = 'button'
  dugme.className = 'rail-home' + (home.selected ? ' selected' : '')
  ipucuVer(dugme, 'Ana sayfa')
  dugme.dataset.odak = 'ana-sayfa'
  if (home.selected) dugme.setAttribute('aria-current', 'page')
  const logo = document.createElement('img')
  logo.src = '/favicon.svg'
  logo.alt = ''
  logo.className = 'rail-home-logo'
  dugme.appendChild(logo)
  const okunmamis = home.unread ?? 0
  if (okunmamis > 0) {
    const rozet = document.createElement('span')
    rozet.className = 'unread-badge'
    rozet.textContent = sayiYazisi(okunmamis)
    dugme.appendChild(rozet)
    dugme.setAttribute('aria-label', `Ana sayfa, ${sayiYazisi(okunmamis)} okunmamış mesaj`)
  }
  dugme.onclick = () => handlers.onHome?.()
  const ayrac = document.createElement('div')
  ayrac.className = 'rail-home-separator'
  ayrac.setAttribute('role', 'separator')
  rail.append(dugme, ayrac)
}
