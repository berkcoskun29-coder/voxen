// Sunucu menüsü, kanal menüsü ve onay/ayar pencereleri.
// Bu dosya yalnız arayüzü kurar; veri işlerini (RPC çağrıları, liste tazeleme) app.js yapar.
// Menü: küçük bir açılır liste (profileCard.js ile aynı kalıp): Esc, dışarı tıklama, Tab, kayma ya da
// pencere boyutu değişince kapanır; kapanınca odak açan düğmeye döner.
import { createModalShell, formAlani } from './modal.js'

const KENAR = 8 // ekran kenarına en az bu kadar boşluk
const ARALIK = 4 // açan düğme ile menü arası

// Menünün yeri: açan düğmenin altında, sol kenarı hizalı (yan: 'sag' ise düğmenin sağında).
// Her durumda ekranın içinde kalır; altta yer yoksa düğmenin üstüne çıkar.
// r: düğmenin getBoundingClientRect'i, boyut: { width, height } menünün, pencere: { width, height }
export function menuPosition(r, boyut, pencere, yan = 'alt') {
  let left
  let top
  if (yan === 'sag') {
    left = r.right + ARALIK
    if (left + boyut.width > pencere.width - KENAR) left = r.left - ARALIK - boyut.width
    top = r.top
  } else {
    left = r.left
    top = r.bottom + ARALIK
    if (top + boyut.height > pencere.height - KENAR) top = r.top - ARALIK - boyut.height
  }
  left = Math.max(KENAR, Math.min(left, pencere.width - boyut.width - KENAR))
  top = Math.max(KENAR, Math.min(top, pencere.height - boyut.height - KENAR))
  return { left, top }
}

let acik = null // { menu, acan, birak } açık menü (en fazla bir tane)

// Açık menüyü kapatır. returnFocus: odak açan düğmeye dönsün mü (Esc ve seçimde evet; dışarı tıklamada hayır).
export function closeMenu({ returnFocus = false } = {}) {
  if (!acik) return
  const { menu, acan, birak } = acik
  acik = null
  birak()
  menu.remove()
  acan?.setAttribute?.('aria-expanded', 'false')
  if (!returnFocus) return
  // Açan düğme bu arada yeniden çizildiyse (kanal paneli) aynı odak anahtarlı yeni düğmeye dön
  let donulecek = acan
  const anahtar = acan?.dataset?.odak
  if (!donulecek?.isConnected && anahtar) {
    donulecek = [...document.querySelectorAll('[data-odak]')].find((e) => e.dataset.odak === anahtar)
  }
  if (donulecek?.isConnected) donulecek.focus()
}

// Bu düğmenin menüsü şu an açık mı? (ikinci tıklama menüyü kapatsın diye)
export function menuAcikMi(opener) {
  return acik?.acan === opener
}

// opener: menüyü açan düğme; etiket: ekran okuyucu için menü adı
// secenekler: [{ yazi, tehlikeli?, tik() }]; seçilince menü kapanır, sonra tik() çalışır
// yan: 'alt' | 'sag'. Dönen: menü öğesi.
export function openMenu({ opener, etiket, secenekler, yan = 'alt' }) {
  closeMenu()
  const menu = document.createElement('div')
  menu.className = 'popup-menu'
  menu.setAttribute('role', 'menu')
  menu.setAttribute('aria-label', etiket)
  const ogeler = secenekler.map((s) => {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'popup-item' + (s.tehlikeli ? ' danger' : '')
    b.setAttribute('role', 'menuitem')
    b.tabIndex = -1
    b.textContent = s.yazi
    b.onclick = () => {
      closeMenu({ returnFocus: true }) // modal açılırsa odak dönüşü açan düğmeye olsun
      s.tik()
    }
    menu.appendChild(b)
    return b
  })
  document.body.appendChild(menu)
  opener?.setAttribute?.('aria-expanded', 'true')

  const konumla = () => {
    const r = opener?.getBoundingClientRect?.() ?? { left: 0, right: 0, top: 0, bottom: 0 }
    const { left, top } = menuPosition(r, { width: menu.offsetWidth, height: menu.offsetHeight }, { width: window.innerWidth, height: window.innerHeight }, yan)
    menu.style.left = left + 'px'
    menu.style.top = top + 'px'
  }
  konumla()

  const tus = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      closeMenu({ returnFocus: true })
    } else if (e.key === 'Tab') {
      closeMenu({ returnFocus: true }) // Tab menüden çıkar; odak açan düğmeden devam eder
    } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
      e.preventDefault()
      const sira = ogeler.indexOf(document.activeElement)
      let yeni
      if (e.key === 'ArrowDown') yeni = (sira + 1) % ogeler.length
      else if (e.key === 'ArrowUp') yeni = (sira - 1 + ogeler.length) % ogeler.length
      else if (e.key === 'Home') yeni = 0
      else yeni = ogeler.length - 1
      ogeler[yeni].focus()
    }
  }
  const basma = (e) => {
    if (menu.contains(e.target)) return
    if (opener?.contains?.(e.target)) return // aynı düğmeye tıklama: düğmenin kendi dinleyicisi kapatır
    closeMenu()
  }
  const kayma = (e) => {
    if (e.target instanceof Node && menu.contains(e.target)) return
    closeMenu()
  }
  const boyut = () => closeMenu()
  document.addEventListener('keydown', tus)
  document.addEventListener('mousedown', basma, true)
  window.addEventListener('scroll', kayma, true)
  window.addEventListener('resize', boyut)
  const birak = () => {
    document.removeEventListener('keydown', tus)
    document.removeEventListener('mousedown', basma, true)
    window.removeEventListener('scroll', kayma, true)
    window.removeEventListener('resize', boyut)
  }
  acik = { menu, acan: opener, birak }
  ogeler[0]?.focus()
  return menu
}

// ---- Sunucu menüsü ----
// sunucu: { name }, sahip: bool, sessiz: sunucu sessizde mi (bildirimler),
// tik: { onInvite, onToggleMute, onSettings, onAddChannel, onLeave, onDelete }
export function openServerMenu({ opener, sunucu, sahip, sessiz = false, tik }) {
  if (menuAcikMi(opener)) { closeMenu({ returnFocus: true }); return null }
  const secenekler = [
    { yazi: 'Davet et', tik: () => tik.onInvite?.() },
    { yazi: sessiz ? 'Sessizden çıkar' : 'Sunucuyu sessize al', tik: () => tik.onToggleMute?.() },
  ]
  if (sahip) {
    secenekler.push({ yazi: 'Sunucu ayarları', tik: () => tik.onSettings?.() })
    secenekler.push({ yazi: 'Kanal ekle', tik: () => tik.onAddChannel?.() })
    secenekler.push({ yazi: 'Sunucuyu sil', tehlikeli: true, tik: () => tik.onDelete?.() })
  } else {
    secenekler.push({ yazi: 'Sunucudan ayrıl', tehlikeli: true, tik: () => tik.onLeave?.() })
  }
  return openMenu({ opener, etiket: `${sunucu.name} sunucu menüsü`, secenekler })
}

// ---- Kanal menüsü (satırdaki ⚙) ----
// tik: { onRename, onDelete }
export function openChannelMenu({ opener, kanal, tik }) {
  if (menuAcikMi(opener)) { closeMenu({ returnFocus: true }); return null }
  return openMenu({
    opener,
    etiket: `${kanal.name} kanal menüsü`,
    yan: 'sag',
    secenekler: [
      { yazi: 'Kanalı yeniden adlandır', tik: () => tik.onRename?.() },
      { yazi: 'Kanalı sil', tehlikeli: true, tik: () => tik.onDelete?.() },
    ],
  })
}

// ---- Pencereler ----
function paragraf(yazi) {
  const p = document.createElement('p')
  p.className = 'confirm-text'
  p.textContent = yazi // kullanıcı yazısı (sunucu/kanal adı) textContent ile basılır
  return p
}

// Sunucudan ayrılma onayı. ayril() hata metni dönerse pencere açık kalır.
export function leaveServerDialog(sunucu, ayril) {
  return createModalShell({
    baslik: 'Sunucudan ayrıl',
    govde: [paragraf(`${sunucu.name} sunucusundan ayrılınsın mı? Davet linkiyle yeniden katılabilirsin.`)],
    birincil: { yazi: 'Ayrıl', tik: ayril },
    tehlikeli: true,
  })
}

// Sunucu silme: adı aynen yazmadan Sil düğmesi pasif kalır.
export function deleteServerDialog(sunucu, sil) {
  const kutu = document.createElement('input')
  kutu.type = 'text'
  kutu.autocomplete = 'off'
  kutu.maxLength = 40
  const f = formAlani(`Onaylamak için sunucu adını yaz: ${sunucu.name}`, kutu)
  const kabuk = createModalShell({
    baslik: 'Sunucuyu sil',
    govde: [paragraf('Bu geri alınamaz. Bütün kanallar ve mesajlar silinir.'), f.etiket, f.input, f.hata],
    birincil: {
      yazi: 'Sil',
      tik: () => {
        if (kutu.value !== sunucu.name) return { alan: kutu, metin: 'Sunucu adını aynen yazmalısın.' }
        return sil()
      },
    },
    tehlikeli: true,
    enterIleKaydet: true,
  })
  const guncelle = () => { kabuk.anaDugme.disabled = kutu.value !== sunucu.name }
  kutu.addEventListener('input', guncelle)
  guncelle()
  return kabuk
}

// Kanal silme onayı
export function deleteChannelDialog(kanal, sil) {
  return createModalShell({
    baslik: 'Kanalı sil',
    govde: [paragraf(`#${kanal.name} kanalı silinsin mi? İçindeki bütün mesajlar silinir.`)],
    birincil: { yazi: 'Sil', tik: sil },
    tehlikeli: true,
  })
}

// Kanalı yeniden adlandır: kaydet(ad) hata metni dönerse pencere açık kalır.
export function renameChannelDialog(kanal, kaydet) {
  const kutu = document.createElement('input')
  kutu.type = 'text'
  kutu.maxLength = 30
  kutu.value = kanal.name
  const f = formAlani('Kanal adı', kutu)
  const kabuk = createModalShell({
    baslik: 'Kanalı yeniden adlandır',
    govde: [f.etiket, f.input, f.hata],
    birincil: {
      yazi: 'Kaydet',
      tik: () => {
        const ad = kutu.value.trim()
        if (ad.length < 1 || ad.length > 30) return { alan: kutu, metin: 'Kanal adı boş olamaz. Bir ad yaz (en fazla 30 karakter).' }
        return kaydet(ad)
      },
    },
    enterIleKaydet: true,
  })
  kutu.select()
  return kabuk
}

// Sunucu ayarları: ad kutusu + Kaydet, davet kodu ve "Davet linkini kopyala".
// kaydet(ad) hata metni dönerse pencere açık kalır; kopyala() davet linkini panoya alır.
export function serverSettingsDialog(sunucu, { kaydet, kopyala }) {
  const kutu = document.createElement('input')
  kutu.type = 'text'
  kutu.maxLength = 40
  kutu.value = sunucu.name
  const f = formAlani('Sunucu adı', kutu)

  const kodEtiket = document.createElement('span')
  kodEtiket.className = 'group-label'
  kodEtiket.textContent = 'Davet kodu'
  const kod = document.createElement('code')
  kod.className = 'invite-code'
  kod.textContent = sunucu.invite_code ?? ''
  const kopya = document.createElement('button')
  kopya.type = 'button'
  kopya.className = 'secondary'
  kopya.textContent = 'Davet linkini kopyala'
  kopya.onclick = () => kopyala?.()

  return createModalShell({
    baslik: 'Sunucu ayarları',
    govde: [f.etiket, f.input, f.hata, kodEtiket, kod, kopya],
    birincil: {
      yazi: 'Kaydet',
      tik: () => {
        const ad = kutu.value.trim()
        if (ad.length < 1 || ad.length > 40) return { alan: kutu, metin: 'Sunucu adı boş olamaz. Bir ad yaz (en fazla 40 karakter).' }
        return kaydet(ad)
      },
    },
    enterIleKaydet: true,
  })
}
