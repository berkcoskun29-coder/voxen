// @bahsetme arayüzü: mesajdaki @ad etiketleri ve yazı kutusundaki öneri listesi.
// Eşleşme kuralı src/mentions.js'te (veritabanıyla aynı). Kullanıcı yazısı HER ZAMAN textContent ile basılır.
import { findMentions } from '../mentions.js'
import { linkParcalari, linkOgesi } from './links.js'
import { makeProfileOpener } from './profileOpener.js'
import { avatarTextColor } from './avatarColor.js'

export const ONERI_SINIRI = 8 // öneri listesinde en fazla kaç kişi

// Mesaj metnini DOM parçası olarak kurar: linkler <a>, sunucuda üyesi olan @adlar etiket olur.
// uyeler: sunucu üyelerinin profilleri ({ id, username, ... }). Üye olmayan @ad düz yazı kalır.
// Etikete tıklayınca o kişinin profil kartı açılır (profileOpener; dinleyici app.js'te).
// Linkin içindeki "@" (ör. https://site.com/@ad) etiket olmaz: önce linkler ayrılır.
export function bahsetmeliMetin(metin, uyeler = []) {
  const parca = document.createDocumentFragment()
  const adlar = uyeler.map((u) => u.username)
  const kisi = (ad) => uyeler.find((u) => u.username === ad)
  for (const p of linkParcalari(metin)) {
    if (p.link) { parca.appendChild(linkOgesi(p)); continue }
    let kalinan = 0
    for (const b of findMentions(p.metin, adlar)) {
      if (b.start > kalinan) parca.appendChild(document.createTextNode(p.metin.slice(kalinan, b.start)))
      const etiket = document.createElement('span')
      etiket.className = 'mention'
      etiket.textContent = p.metin.slice(b.start, b.end) // yazıldığı gibi (büyük-küçük harf korunur)
      makeProfileOpener(etiket, kisi(b.username), null, { yalnizFare: true }) // klavyede durak üye listesi/avatar
      parca.appendChild(etiket)
      kalinan = b.end
    }
    if (kalinan < p.metin.length) parca.appendChild(document.createTextNode(p.metin.slice(kalinan)))
  }
  return parca
}

// İmlecin hemen solundaki "@yazılan" parçası: { bas, sorgu } ya da null.
// "@" metnin başında ya da harf/rakam/_ olmayan bir karakterden sonra olmalı (e-posta yazarken açılmasın).
export function imlectekiSorgu(metin, imlec) {
  const e = /(?:^|[^\p{L}\p{N}_])@([^\s@]{0,20})$/u.exec(metin.slice(0, imlec))
  if (!e) return null
  return { bas: imlec - e[1].length - 1, sorgu: e[1] }
}

// Sorguya uyan üyeler: önce adı sorguyla başlayanlar, sonra adında geçenler; en fazla 8 kişi.
export function oneriler(uyeler, sorgu, selfId = null) {
  const q = sorgu.toLowerCase()
  const adaylar = uyeler.filter((u) => u.id !== selfId && u.username.toLowerCase().includes(q))
  const basla = adaylar.filter((u) => u.username.toLowerCase().startsWith(q))
  const icinde = adaylar.filter((u) => !u.username.toLowerCase().startsWith(q))
  return [...basla, ...icinde].slice(0, ONERI_SINIRI)
}

let oneriSayaci = 0

// Yazı kutusuna öneri listesini bağlar. "@" yazınca açılır; ↑↓ gezer, Enter/Tab seçer, Esc kapatır.
// kutu: textarea. getMembers(): sunucu üyeleri. selfId: kendimiz listede çıkmaz.
// Liste öğesi (el) çağıran tarafından yazı kutusunun üstüne konur (chatView, .composer içinde).
// ÖNEMLİ: kutunun keydown dinleyicisinden ÖNCE bağlanmalı; seçim tuşlarında preventDefault çağrılır,
// chatView de defaultPrevented ise Enter'la göndermez.
export function mountMentionSuggest(kutu, { getMembers, selfId = null }) {
  const listeId = `bahsetme-onerileri-${++oneriSayaci}`
  const el = document.createElement('ul')
  el.className = 'mention-suggest'
  el.id = listeId
  el.setAttribute('role', 'listbox')
  el.setAttribute('aria-label', 'Bahsedilecek kişi')
  el.hidden = true
  kutu.setAttribute('aria-autocomplete', 'list')
  kutu.setAttribute('aria-controls', listeId)
  kutu.setAttribute('aria-expanded', 'false')

  let kisiler = [] // görünen öneriler
  let secili = 0
  let sorgu = null // { bas, sorgu }

  function kapat() {
    if (el.hidden) return
    el.hidden = true
    el.innerHTML = ''
    kisiler = []
    sorgu = null
    kutu.setAttribute('aria-expanded', 'false')
    kutu.removeAttribute('aria-activedescendant')
  }

  function ciz() {
    el.innerHTML = ''
    kisiler.forEach((k, i) => {
      const li = document.createElement('li')
      li.className = 'mention-option' + (i === secili ? ' selected' : '')
      li.id = `${listeId}-${i}`
      li.setAttribute('role', 'option')
      li.setAttribute('aria-selected', String(i === secili))
      li.append(kucukAvatar(k))
      const ad = document.createElement('span')
      ad.className = 'mention-option-name'
      ad.textContent = k.username
      li.appendChild(ad)
      li.addEventListener('mousedown', (e) => e.preventDefault()) // kutudaki odak kaybolmasın
      li.addEventListener('click', () => sec(i))
      el.appendChild(li)
    })
    el.hidden = false
    kutu.setAttribute('aria-expanded', 'true')
    kutu.setAttribute('aria-activedescendant', `${listeId}-${secili}`)
  }

  // Kutudaki metne göre listeyi açar, günceller ya da kapatır
  function guncelle() {
    const s = kutu.selectionStart === kutu.selectionEnd ? imlectekiSorgu(kutu.value, kutu.selectionStart) : null
    const bulunan = s ? oneriler(getMembers?.() ?? [], s.sorgu, selfId) : []
    if (bulunan.length === 0) { kapat(); return }
    // Aynı kişiler kaldıysa seçim yerinde kalsın
    const oncekiId = kisiler[secili]?.id
    kisiler = bulunan
    sorgu = s
    secili = Math.max(0, kisiler.findIndex((k) => k.id === oncekiId))
    ciz()
  }

  // Seçilen kişiyi "@ad " olarak yazılanın yerine koyar
  function sec(i) {
    const k = kisiler[i]
    if (!k || !sorgu) return
    const ek = `@${k.username} `
    const son = sorgu.bas + 1 + sorgu.sorgu.length
    kutu.value = kutu.value.slice(0, sorgu.bas) + ek + kutu.value.slice(son)
    const imlec = sorgu.bas + ek.length
    kutu.setSelectionRange(imlec, imlec)
    kapat()
    kutu.focus()
    kutu.dispatchEvent(new Event('input', { bubbles: true })) // sayaç ve "yazıyor" güncellensin
  }

  function tus(e) {
    if (el.hidden || e.isComposing) return
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const n = kisiler.length
      secili = (secili + (e.key === 'ArrowDown' ? 1 : -1) + n) % n
      ciz()
    } else if ((e.key === 'Enter' && !e.shiftKey) || (e.key === 'Tab' && !e.shiftKey)) {
      e.preventDefault()
      sec(secili)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation() // açık bir pencere ya da başka bir Esc dinleyicisi de kapanmasın
      kapat()
    }
  }

  kutu.addEventListener('keydown', tus)
  kutu.addEventListener('input', guncelle)
  kutu.addEventListener('click', guncelle) // imleç fareyle başka yere götürüldü
  kutu.addEventListener('blur', kapat)

  return {
    el,
    isOpen: () => !el.hidden,
    close: kapat,
    destroy() {
      kapat()
      kutu.removeEventListener('keydown', tus)
      kutu.removeEventListener('input', guncelle)
      kutu.removeEventListener('click', guncelle)
      kutu.removeEventListener('blur', kapat)
    },
  }
}

// Öneri satırındaki küçük avatar (resim ya da renkli zeminde baş harf)
function kucukAvatar(k) {
  let av
  if (k.avatar_url) {
    av = document.createElement('img')
    av.src = k.avatar_url
    av.alt = ''
  } else {
    av = document.createElement('span')
    av.textContent = (Array.from(k.username)[0] ?? '?').toLocaleUpperCase('tr')
    av.setAttribute('aria-hidden', 'true')
  }
  av.className = 'mention-option-avatar'
  av.style.background = k.color
  av.style.color = avatarTextColor(k.color)
  return av
}
