// Sunucu menüsü, kanal menüsü ve onay/ayar pencereleri.
// Bu dosya yalnız arayüzü kurar; veri işlerini (RPC çağrıları, liste tazeleme) app.js yapar.
// Menü: küçük bir açılır liste (profileCard.js ile aynı kalıp): Esc, dışarı tıklama, Tab, kayma ya da
// pencere boyutu değişince kapanır; kapanınca odak açan düğmeye döner.
import { createModalShell, formAlani } from './modal.js'
import { DUZEYLER, DUZEY_YAZILARI, SESSIZ_SURELERI, VARSAYILAN_DUZEY } from '../bildirimDuzeyi.js'

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
const kapanisIsleri = [] // menü kapanınca bir kez çalışacak işler (ertelenmiş çizimler için)

// Menü kapanınca fn bir kez çalışır (çağıran önce herhangiMenuAcikMi() ile menünün açık olduğunu görür).
export function menuKapaninca(fn) {
  kapanisIsleri.push(fn)
}

function kapanisIsleriniCalistir() {
  for (const fn of kapanisIsleri.splice(0)) {
    try { fn() } catch (e) { console.error(e) } // biri patlarsa diğerleri yine çalışır
  }
}

// Açık menüyü kapatır. returnFocus: odak açan düğmeye dönsün mü (Esc ve seçimde evet; dışarı tıklamada hayır).
export function closeMenu({ returnFocus = false } = {}) {
  if (!acik) return
  const { menu, acan, birak } = acik
  acik = null
  birak()
  menu.remove()
  acan?.setAttribute?.('aria-expanded', 'false')
  if (!returnFocus) { kapanisIsleriniCalistir(); return }
  // Açan düğme bu arada yeniden çizildiyse (kanal paneli) aynı odak anahtarlı yeni düğmeye dön
  let donulecek = acan
  const anahtar = acan?.dataset?.odak
  if (!donulecek?.isConnected && anahtar) {
    donulecek = [...document.querySelectorAll('[data-odak]')].find((e) => e.dataset.odak === anahtar)
  }
  if (donulecek?.isConnected) donulecek.focus()
  kapanisIsleriniCalistir()
}

// Bu düğmenin menüsü şu an açık mı? (ikinci tıklama menüyü kapatsın diye)
export function menuAcikMi(opener) {
  return acik?.acan === opener
}

// Herhangi bir menü şu an açık mı?
export function herhangiMenuAcikMi() {
  return !!acik
}

// opener: menüyü açan düğme; etiket: ekran okuyucu için menü adı
// secenekler: [{ yazi, tehlikeli?, secili?, tik() }]; seçilince menü kapanır, sonra tik() çalışır.
//   secili (true/false) verilirse öğe seçimli olur (role="menuitemradio", aria-checked; seçilide ✓).
//   { baslik } odaklanmayan küçük bölüm başlığı, { ayirici: true } ince çizgi (v0.13.0).
// yan: 'alt' | 'sag'. Dönen: menü öğesi.
export function openMenu({ opener, etiket, secenekler, yan = 'alt' }) {
  closeMenu()
  const menu = document.createElement('div')
  menu.className = 'popup-menu'
  menu.setAttribute('role', 'menu')
  menu.setAttribute('aria-label', etiket)
  const ogeler = []
  for (const s of secenekler) {
    if (s.baslik != null) {
      const h = document.createElement('div')
      h.className = 'popup-heading'
      h.setAttribute('role', 'presentation')
      h.textContent = s.baslik
      menu.appendChild(h)
      continue
    }
    if (s.ayirici) {
      const c = document.createElement('div')
      c.className = 'popup-sep'
      c.setAttribute('role', 'separator')
      menu.appendChild(c)
      continue
    }
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'popup-item' + (s.tehlikeli ? ' danger' : '')
    if (typeof s.secili === 'boolean') {
      b.setAttribute('role', 'menuitemradio')
      b.setAttribute('aria-checked', String(s.secili))
    } else {
      b.setAttribute('role', 'menuitem')
    }
    b.tabIndex = -1
    b.textContent = s.yazi
    b.onclick = () => {
      closeMenu({ returnFocus: true }) // modal açılırsa odak dönüşü açan düğmeye olsun
      s.tik()
    }
    menu.appendChild(b)
    ogeler.push(b)
  }
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
// izinler (v0.11.0, isteğe bağlı): { has(perm) } güncel yetkim (src/data/rolKurallari.js). Verilmezse
//   yalnız sahip yönetir (eski davranış). "Sunucuyu sil" her durumda yalnız sahipte.
// tik: { onInvite, onToggleMute, onSettings, onAddChannel, onLeave, onDelete }
// v0.13.0: tik.onLevel(düzey) verilirse "Bildirim ayarları" başlığı altında üç düzey (duzey: şu anki,
// yoksa varsayılan) çıkar; tik.onMarkRead verilirse "Tümünü okundu say".
export function openServerMenu({ opener, sunucu, sahip, izinler = null, sessiz = false, duzey = null, tik }) {
  if (menuAcikMi(opener)) { closeMenu({ returnFocus: true }); return null }
  const izin = (p) => !!sahip || !!izinler?.has?.(p)
  const secenekler = [{ yazi: 'Davet et', tik: () => tik.onInvite?.() }]
  if (tik.onMarkRead) secenekler.push({ yazi: 'Tümünü okundu say', tik: () => tik.onMarkRead() })
  if (tik.onLevel) {
    const secili = duzey ?? VARSAYILAN_DUZEY
    secenekler.push({ ayirici: true }, { baslik: 'Bildirim ayarları' })
    for (const d of DUZEYLER) secenekler.push({ yazi: DUZEY_YAZILARI[d], secili: d === secili, tik: () => tik.onLevel(d) })
  }
  secenekler.push({ yazi: sessiz ? 'Sessizden çıkar' : 'Sunucuyu sessize al', tik: () => tik.onToggleMute?.() })
  if (tik.onLevel) secenekler.push({ ayirici: true })
  if (izin('MANAGE_SERVER') || izin('MANAGE_ROLES')) secenekler.push({ yazi: 'Sunucu ayarları', tik: () => tik.onSettings?.() })
  if (izin('MANAGE_CHANNELS')) secenekler.push({ yazi: 'Kanal ekle', tik: () => tik.onAddChannel?.() })
  if (sahip) {
    secenekler.push({ yazi: 'Sunucuyu sil', tehlikeli: true, tik: () => tik.onDelete?.() })
  } else {
    secenekler.push({ yazi: 'Sunucudan ayrıl', tehlikeli: true, tik: () => tik.onLeave?.() })
  }
  return openMenu({ opener, etiket: `${sunucu.name} sunucu menüsü`, secenekler })
}

// ---- Kanal menüsü (satırdaki ⚙) ----
// tik: { onRename, onDelete, onMoveUp?, onMoveDown? } (taşıma işlevi verilmezse o öğe yok: listenin ucunda)
export function openChannelMenu({ opener, kanal, tik }) {
  if (menuAcikMi(opener)) { closeMenu({ returnFocus: true }); return null }
  const secenekler = [{ yazi: 'Kanalı yeniden adlandır', tik: () => tik.onRename?.() }]
  if (tik.onMoveUp) secenekler.push({ yazi: 'Yukarı taşı', tik: () => tik.onMoveUp() })
  if (tik.onMoveDown) secenekler.push({ yazi: 'Aşağı taşı', tik: () => tik.onMoveDown() })
  secenekler.push({ yazi: 'Kanalı sil', tehlikeli: true, tik: () => tik.onDelete?.() })
  return openMenu({ opener, etiket: `${kanal.name} kanal menüsü`, yan: 'sag', secenekler })
}

// ---- Kanal bildirim menüsü (v0.13.0): kanala sağ tık ya da başlıktaki 🔔 ----
// duzey: kanalın kendi düzeyi (null = sunucu varsayılanı), sunucuDuzeyi: sunucununki (yazıda gösterilir),
// sessiz: kanal şu an sessizde mi, sessizBitis: ISO metni ya da null (ben açana kadar).
// tik: { onLevel(düzey | null), onMute(saat | null), onUnmute() }
export function openChannelNotifyMenu({ opener, kanal, duzey = null, sunucuDuzeyi = null, sessiz = false, sessizBitis = null, yan = 'alt', tik }) {
  if (menuAcikMi(opener)) { closeMenu({ returnFocus: true }); return null }
  const varsayilan = DUZEY_YAZILARI[sunucuDuzeyi ?? VARSAYILAN_DUZEY]
  const secenekler = [
    { baslik: 'Bildirim ayarları' },
    { yazi: `Sunucu varsayılanı (${varsayilan})`, secili: duzey == null, tik: () => tik.onLevel?.(null) },
  ]
  for (const d of DUZEYLER) secenekler.push({ yazi: DUZEY_YAZILARI[d], secili: d === duzey, tik: () => tik.onLevel?.(d) })
  secenekler.push({ ayirici: true })
  if (sessiz) {
    secenekler.push({ baslik: `Sessizde: ${bitisYazisi(sessizBitis)}` }, { yazi: 'Sessizden çıkar', tik: () => tik.onUnmute?.() })
  } else {
    secenekler.push({ baslik: 'Kanalı sessize al' })
    for (const s of SESSIZ_SURELERI) secenekler.push({ yazi: s.yazi, tik: () => tik.onMute?.(s.saat) })
  }
  return openMenu({ opener, etiket: `${kanal.name} bildirim ayarları`, yan, secenekler })
}

// "ben açana kadar" ya da "15 Kas 14:30'a kadar"
function bitisYazisi(iso) {
  if (iso == null) return 'ben açana kadar'
  const t = new Date(iso)
  if (Number.isNaN(t.getTime())) return 'ben açana kadar'
  const saat = t.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })
  const bugun = new Date().toDateString() === t.toDateString()
  const gun = bugun ? '' : t.toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' }) + ' '
  return `${gun}${saat} kadar`
}

// ---- DM bildirim menüsü (v0.13.0): DM başlığındaki 🔔 ----
export function openDmNotifyMenu({ opener, ad, sessiz = false, onToggle }) {
  if (menuAcikMi(opener)) { closeMenu({ returnFocus: true }); return null }
  return openMenu({
    opener,
    etiket: `${ad} bildirim ayarları`,
    secenekler: [{ yazi: sessiz ? 'Sessizden çıkar' : 'Konuşmayı sessize al', tik: () => onToggle?.() }],
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

// Üyeyi çıkarma onayı (v0.11.0). cikar() hata metni dönerse pencere açık kalır.
export function kickMemberDialog(kisi, sunucu, cikar) {
  return createModalShell({
    baslik: 'Sunucudan çıkar',
    govde: [paragraf(`${kisi.username}, ${sunucu.name} sunucusundan çıkarılsın mı? Davet linkiyle yeniden katılabilir.`)],
    birincil: { yazi: 'Çıkar', tik: cikar },
    tehlikeli: true,
  })
}

// Sunucu ayarları: ad kutusu + Kaydet, davet kodu, "Davet linkini kopyala" ve (verilirse) "Davet kodunu yenile".
// kaydet(ad) hata metni dönerse pencere açık kalır; kopyala() davet linkini panoya alır;
// yenile() (v0.11.0) onaydan sonra çağrılır: { kod } ya da hata metni döner.
// Sekmeler (v0.11.0): roller verilirse pencere "Genel" ve "Roller" sekmeli açılır (ayarlar penceresinin
//   sekme kalıbı). roller(): { el, kapat? } Roller sekmesinin içeriği (src/ui/roles.js). genel false ise
//   (MANAGE_SERVER yok) yalnız Roller sekmesi olur ve Kaydet düğmesi çıkmaz.
// Dönen: createModalShell sonucu + kod(yeni): görünen davet kodunu günceller (canlı yenileme).
export function serverSettingsDialog(sunucu, { kaydet, kopyala, yenile = null, roller = null, genel = true }) {
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
  const genelOgeler = [f.etiket, f.input, f.hata, kodEtiket, kod, kopya]

  if (yenile) {
    const yeni = document.createElement('button')
    yeni.type = 'button'
    yeni.className = 'secondary invite-renew'
    yeni.textContent = 'Davet kodunu yenile'
    const durum = document.createElement('p')
    durum.className = 'invite-renew-status'
    durum.setAttribute('role', 'status')
    yeni.onclick = () => {
      createModalShell({
        baslik: 'Davet kodunu yenile',
        govde: [paragraf('Davet kodu yenilensin mi? Eski davet linkleri artık çalışmaz.')],
        birincil: {
          yazi: 'Yenile',
          tik: async () => {
            const sonuc = await yenile()
            if (typeof sonuc === 'string' && sonuc) return sonuc
            if (sonuc?.kod) kod.textContent = sonuc.kod
            durum.textContent = 'Davet kodu yenilendi.'
            return null
          },
        },
      })
    }
    genelOgeler.push(yeni, durum)
  }

  const kaydetIsi = {
    yazi: 'Kaydet',
    tik: () => {
      const ad = kutu.value.trim()
      if (ad.length < 1 || ad.length > 40) return { alan: kutu, metin: 'Sunucu adı boş olamaz. Bir ad yaz (en fazla 40 karakter).' }
      return kaydet(ad)
    },
  }
  const kodYaz = (k) => { kod.textContent = k ?? '' }

  if (!roller) {
    const kabuk = createModalShell({ baslik: 'Sunucu ayarları', govde: genelOgeler, birincil: kaydetIsi, enterIleKaydet: true })
    return { ...kabuk, kod: kodYaz }
  }

  // Sekmeli: Genel (izin varsa) + Roller
  const rolIcerik = roller()
  const bolumler = []
  if (genel) {
    const g = document.createElement('section')
    g.className = 'settings-section'
    g.append(...genelOgeler)
    bolumler.push({ ad: 'genel', baslik: 'Genel', kutu: g })
  }
  const r = document.createElement('section')
  r.className = 'settings-section'
  r.appendChild(rolIcerik.el)
  bolumler.push({ ad: 'roller', baslik: 'Roller', kutu: r })

  const duzen = document.createElement('div')
  duzen.className = 'settings-layout'
  const menu = document.createElement('div')
  menu.className = 'settings-nav'
  menu.setAttribute('role', 'tablist')
  menu.setAttribute('aria-label', 'Sunucu ayarları bölümleri')
  const sag = document.createElement('div')
  sag.className = 'settings-panels'
  const sekmeler = bolumler.map((b) => {
    const sekme = document.createElement('button')
    sekme.type = 'button'
    sekme.textContent = b.baslik
    sekme.id = `sunucu-sekme-${b.ad}`
    sekme.setAttribute('role', 'tab')
    sekme.setAttribute('aria-controls', `sunucu-bolum-${b.ad}`)
    b.kutu.id = `sunucu-bolum-${b.ad}`
    b.kutu.setAttribute('role', 'tabpanel')
    b.kutu.setAttribute('aria-labelledby', sekme.id)
    sekme.onclick = () => sec(b.ad)
    menu.appendChild(sekme)
    sag.appendChild(b.kutu)
    return sekme
  })
  duzen.append(menu, sag)

  const kabuk = createModalShell({
    baslik: 'Sunucu ayarları',
    govde: [duzen],
    birincil: genel ? kaydetIsi : null,
    ikincil: 'Kapat',
    genis: true,
    odakBasliga: true,
    onKapat: () => rolIcerik.kapat?.(),
  })
  kabuk.kart.classList.add('settings-card')
  // Enter yalnız sunucu adı kutusunda kaydeder (Roller sekmesindeki kutular sunucu adını kaydetmesin)
  kutu.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.isComposing) return
    e.preventDefault()
    kabuk.anaDugme?.click()
  })

  // Kaydet yalnız Genel sekmesinde görünür (Roller'de her rolün kendi Kaydet'i var)
  function sec(ad, odakla = false) {
    bolumler.forEach((b, i) => {
      const secili = b.ad === ad
      sekmeler[i].setAttribute('aria-selected', String(secili))
      sekmeler[i].tabIndex = secili ? 0 : -1
      b.kutu.hidden = !secili
      if (secili && odakla) sekmeler[i].focus()
    })
    if (kabuk.anaDugme) kabuk.anaDugme.hidden = ad !== 'genel'
  }
  // Sekmeler arasında ok tuşları, Home, End (ayarlar penceresiyle aynı)
  menu.addEventListener('keydown', (e) => {
    const simdiki = sekmeler.indexOf(document.activeElement)
    if (simdiki < 0) return
    const n = sekmeler.length
    let yeni
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') yeni = (simdiki + 1) % n
    else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') yeni = (simdiki - 1 + n) % n
    else if (e.key === 'Home') yeni = 0
    else if (e.key === 'End') yeni = n - 1
    else return
    e.preventDefault()
    sec(bolumler[yeni].ad, true)
  })
  sec(bolumler[0].ad)
  return { ...kabuk, kod: kodYaz, sec }
}
