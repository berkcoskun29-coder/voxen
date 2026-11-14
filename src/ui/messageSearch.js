// Mesaj arama arayüzü (v0.10.0): başlıktaki 🔍 kutusu, filtre önerileri ve sağdaki sonuç paneli.
// Ayrıştırma, katlama, vurgu ve öneri kuralları src/data/aramaFiltre.js'te; RPC src/data/search.js'te.
// Kullanıcı yazısı HER ZAMAN textContent ile basılır; vurgu <mark> öğeleriyle kurulur (innerHTML yok).
import {
  aramaCozumle, aramaUyarisi, vurguParcalari, oneriler, oneriUygula, ARAMA_UYARILARI, ARAMA_GECIKME_MS,
} from '../data/aramaFiltre.js'

export const ARAMA_METINLERI = {
  kutu: 'Ara',
  kutuEtiketi: 'Mesajlarda ara',
  ipucu: 'Mesajlarda ara (Ctrl+F)',
  baslik: 'Arama sonuçları',
  kapat: 'Aramayı kapat',
  araniyor: 'Aranıyor…',
  yok: 'Sonuç bulunamadı.',
  hata: 'Arama yapılamadı. Tekrar dene.',
  dahaFazla: 'Daha fazla',
  filtreler: 'Filtreler',
  bilinmeyen: 'Bilinmeyen',
}
const DAR_PENCERE = 1100 // bundan dar pencerede sonuca tıklayınca panel kapanır (sohbete yer kalsın)
const tarihBicimi = new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })

// Sonucun yeri: #kanal, bire birde @kişi, grupta grubun adı
export function yerYazisi(s) {
  if (s.tur === 'channel') return `#${s.yer_adi ?? ''}`
  if (s.is_group) return s.yer_adi || 'Grup'
  return `@${s.yer_adi || ARAMA_METINLERI.bilinmeyen}`
}

// Vurgulu parçayı DOM'a çevirir: düz kısımlar metin düğümü, eşleşenler <mark>
export function vurguluParca(icerik, metin) {
  const parca = document.createDocumentFragment()
  for (const p of vurguParcalari(icerik, metin)) {
    if (p.vurgu) {
      const m = document.createElement('mark')
      m.textContent = p.yazi
      parca.appendChild(m)
    } else parca.appendChild(document.createTextNode(p.yazi))
  }
  return parca
}

let sayac = 0

// ara(cozum, { oncesi }) -> Promise<{ sonuclar, dahaVar }> (kapsam app.js'te bağlanır).
// kapsam() -> 'sunucu' | 'dm'. bilgi() -> { kisiler: [ad], kanallar: [ad] } (öneriler için).
// onOpen(sonuc): sonuca tıklandı (app.js konuşmayı açar ve mesaja gider).
// Dönen: { kutu (başlığa konur), panel (düzende ana alanın sağına konur), odakla(), kapat(), sifirla(), destroy() }
export function createMessageSearch({ ara, kapsam = () => 'sunucu', bilgi = () => ({}), onOpen = () => {} }) {
  const no = ++sayac
  // ---- Kutu ----
  const kutu = document.createElement('div')
  kutu.className = 'search-box'
  kutu.setAttribute('role', 'search')
  const simge = document.createElement('span')
  simge.className = 'search-icon'
  simge.setAttribute('aria-hidden', 'true')
  simge.textContent = '🔍'
  const girdi = document.createElement('input')
  girdi.type = 'search'
  girdi.className = 'search-input'
  girdi.placeholder = ARAMA_METINLERI.kutu
  girdi.maxLength = 300
  girdi.autocomplete = 'off'
  girdi.spellcheck = false
  girdi.setAttribute('aria-label', ARAMA_METINLERI.kutuEtiketi)
  girdi.setAttribute('role', 'combobox')
  girdi.setAttribute('aria-autocomplete', 'list')
  girdi.setAttribute('aria-expanded', 'false')
  girdi.dataset.tip = ARAMA_METINLERI.ipucu
  girdi.dataset.tipSide = 'bottom'
  const listeId = `arama-onerileri-${no}`
  girdi.setAttribute('aria-controls', listeId)
  // Öneri kutusu: boş kutuda "Filtreler" başlığıyla yardım ipucu da budur
  const oneriKutusu = document.createElement('div')
  oneriKutusu.className = 'search-suggest'
  oneriKutusu.hidden = true
  const oneriBasligi = document.createElement('p')
  oneriBasligi.className = 'search-suggest-title'
  oneriBasligi.setAttribute('aria-hidden', 'true')
  oneriBasligi.textContent = ARAMA_METINLERI.filtreler
  const oneriListesi = document.createElement('ul')
  oneriListesi.id = listeId
  oneriListesi.setAttribute('role', 'listbox')
  oneriListesi.setAttribute('aria-label', ARAMA_METINLERI.filtreler)
  oneriKutusu.append(oneriBasligi, oneriListesi)
  // Listeye tıklarken kutu odağı kaybetmesin (blur listeyi kapatırdı)
  oneriKutusu.addEventListener('mousedown', (e) => e.preventDefault())
  kutu.append(simge, girdi, oneriKutusu)

  // ---- Panel ----
  const panel = document.createElement('aside')
  panel.className = 'search-panel'
  panel.hidden = true
  panel.setAttribute('aria-label', ARAMA_METINLERI.baslik)
  const ust = document.createElement('div')
  ust.className = 'search-panel-head'
  const baslik = document.createElement('h2')
  baslik.textContent = ARAMA_METINLERI.baslik
  const kapatDugmesi = document.createElement('button')
  kapatDugmesi.type = 'button'
  kapatDugmesi.className = 'icon-btn search-close'
  kapatDugmesi.setAttribute('aria-label', ARAMA_METINLERI.kapat)
  kapatDugmesi.dataset.tip = `${ARAMA_METINLERI.kapat} (Esc)`
  kapatDugmesi.dataset.tipSide = 'bottom'
  kapatDugmesi.textContent = '✕'
  kapatDugmesi.onclick = () => { kapat(); girdi.focus() }
  ust.append(baslik, kapatDugmesi)
  const durum = document.createElement('p')
  durum.className = 'search-status'
  durum.setAttribute('role', 'status')
  const sonucListesi = document.createElement('ul')
  sonucListesi.className = 'search-results'
  sonucListesi.setAttribute('aria-label', ARAMA_METINLERI.baslik)
  const dahaDugmesi = document.createElement('button')
  dahaDugmesi.type = 'button'
  dahaDugmesi.className = 'secondary search-more'
  dahaDugmesi.textContent = ARAMA_METINLERI.dahaFazla
  dahaDugmesi.hidden = true
  dahaDugmesi.onclick = () => dahaFazla()
  panel.append(ust, durum, sonucListesi, dahaDugmesi)
  panel.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); kapat(); girdi.focus() }
  })

  // ---- Durum ----
  let zamanlayici = null
  let sira = 0 // her yeni arama artırır: eski isteğin cevabı yenisini ezmez
  let sonCozum = null // ekrandaki sonuçların araması ("Daha fazla" bununla devam eder)
  let sonId = null // ekrandaki son sonucun id'si (imleç)
  let kapandi = false
  let secenekler = { bas: 0, son: 0, liste: [] }
  let etkin = -1

  // ---- Öneriler ----
  function onerileriGuncelle() {
    const b = bilgi() ?? {}
    secenekler = oneriler(girdi.value, girdi.selectionStart ?? girdi.value.length, { kapsam: kapsam(), kisiler: b.kisiler ?? [], kanallar: b.kanallar ?? [] })
    etkin = -1
    oneriListesi.textContent = ''
    secenekler.liste.forEach((o, i) => {
      const li = document.createElement('li')
      li.id = `${listeId}-${i}`
      li.className = 'search-option'
      li.setAttribute('role', 'option')
      li.setAttribute('aria-selected', 'false')
      const etiket = document.createElement('span')
      etiket.className = 'search-option-label'
      etiket.textContent = o.etiket
      li.appendChild(etiket)
      if (o.aciklama) {
        const ac = document.createElement('span')
        ac.className = 'search-option-desc'
        ac.textContent = o.aciklama
        li.appendChild(ac)
      }
      li.addEventListener('click', () => sec(i))
      oneriListesi.appendChild(li)
    })
    oneriBasligi.hidden = girdi.value.trim() !== ''
    onerileriGoster(secenekler.liste.length > 0 && document.activeElement === girdi)
  }
  function onerileriGoster(acik) {
    oneriKutusu.hidden = !acik
    girdi.setAttribute('aria-expanded', String(acik))
    if (!acik) { etkin = -1; girdi.removeAttribute('aria-activedescendant') }
  }
  function etkinYap(i) {
    const ogeler = [...oneriListesi.children]
    if (!ogeler.length) return
    etkin = (i + ogeler.length) % ogeler.length
    ogeler.forEach((li, j) => li.setAttribute('aria-selected', String(j === etkin)))
    girdi.setAttribute('aria-activedescendant', ogeler[etkin].id)
    ogeler[etkin].scrollIntoView?.({ block: 'nearest' })
  }
  function sec(i) {
    const o = secenekler.liste[i]
    if (!o) return
    const { metin, imlec } = oneriUygula(girdi.value, secenekler, o)
    girdi.value = metin
    girdi.focus()
    try { girdi.setSelectionRange(imlec, imlec) } catch { /* sorun değil */ }
    onerileriGuncelle()
    zamanla()
  }

  // ---- Arama ----
  function zamanla() {
    clearTimeout(zamanlayici)
    zamanlayici = setTimeout(() => calistir(false), ARAMA_GECIKME_MS)
  }
  function panelAc() {
    panel.hidden = false
  }
  function temizle() {
    sonucListesi.textContent = ''
    dahaDugmesi.hidden = true
    dahaDugmesi.disabled = false // yarıda kalan "Daha fazla" isteği düğmeyi kilitli bırakmasın
    sonCozum = null
    sonId = null
  }
  // hemen: Enter ile (kısa sorgu uyarısı da gösterilir). Yazarken (hemen=false) kısa sorgu paneli açmaz.
  async function calistir(hemen) {
    clearTimeout(zamanlayici)
    if (kapandi) return
    const c = aramaCozumle(girdi.value, { kapsam: kapsam() })
    const uyari = aramaUyarisi(c)
    if (uyari === '') { sira++; temizle(); durum.textContent = ''; kapat(); return } // kutu boşaldı
    if (uyari) {
      if (!hemen && uyari === ARAMA_UYARILARI.kisa && panel.hidden) return
      sira++
      temizle()
      durum.textContent = uyari
      panelAc()
      return
    }
    const benim = ++sira
    temizle()
    durum.textContent = ARAMA_METINLERI.araniyor
    panelAc()
    let r
    try { r = await ara(c, { oncesi: null }) } catch (e) {
      if (benim === sira && !kapandi) durum.textContent = e?.message || ARAMA_METINLERI.hata
      return
    }
    if (benim !== sira || kapandi) return // bu arada yeni arama başladı
    sonCozum = c
    ciz(r, true)
  }
  async function dahaFazla() {
    if (!sonCozum || sonId == null) return
    const benim = sira
    dahaDugmesi.disabled = true
    let r
    try { r = await ara(sonCozum, { oncesi: sonId }) } catch (e) {
      if (benim === sira && !kapandi) { dahaDugmesi.disabled = false; durum.textContent = e?.message || ARAMA_METINLERI.hata }
      return
    }
    if (benim !== sira || kapandi) return
    dahaDugmesi.disabled = false
    ciz(r, false)
  }
  function ciz({ sonuclar = [], dahaVar = false }, bastan) {
    if (bastan) {
      sonucListesi.textContent = ''
      dahaDugmesi.disabled = false // yeni arama: önceki aramanın yarıda kalan "Daha fazla"sı kilit bırakmaz
    }
    const ilkYeni = sonucListesi.children.length
    for (const s of sonuclar) sonucListesi.appendChild(satirKur(s))
    if (sonuclar.length) sonId = sonuclar.at(-1).id
    dahaDugmesi.hidden = !dahaVar
    const toplam = sonucListesi.children.length
    durum.textContent = toplam === 0 ? ARAMA_METINLERI.yok : (dahaVar ? `${toplam}+ sonuç` : `${toplam} sonuç`)
    // "Daha fazla"dan sonra odak ilk yeni sonuca geçer (düğme gizlendiyse odak kaybolmasın)
    if (!bastan && sonuclar.length) sonucListesi.children[ilkYeni]?.querySelector('button')?.focus()
  }
  function satirKur(s) {
    const li = document.createElement('li')
    li.className = 'search-result'
    li.dataset.id = String(s.id)
    const git = document.createElement('button')
    git.type = 'button'
    git.className = 'search-result-go'
    const bas = document.createElement('span')
    bas.className = 'search-result-head'
    const yazar = document.createElement('strong')
    yazar.className = 'search-result-author'
    yazar.textContent = s.author_name || ARAMA_METINLERI.bilinmeyen
    const yer = document.createElement('span')
    yer.className = 'search-result-place'
    yer.textContent = yerYazisi(s)
    const zaman = document.createElement('time')
    zaman.className = 'search-result-date'
    const t = new Date(s.created_at)
    if (!Number.isNaN(t.getTime())) {
      zaman.dateTime = t.toISOString()
      zaman.textContent = tarihBicimi.format(t)
    }
    bas.append(yazar, yer, zaman)
    const metin = document.createElement('span')
    metin.className = 'search-result-text'
    metin.appendChild(vurguluParca(s.content ?? '', sonCozum?.metin ?? ''))
    git.append(bas, metin)
    git.onclick = () => {
      onOpen(s)
      if ((globalThis.innerWidth ?? DAR_PENCERE) < DAR_PENCERE) kapat()
    }
    li.appendChild(git)
    return li
  }

  // ---- Kutu olayları ----
  girdi.addEventListener('input', () => { onerileriGuncelle(); zamanla() })
  girdi.addEventListener('focus', () => onerileriGuncelle())
  girdi.addEventListener('click', () => onerileriGuncelle())
  girdi.addEventListener('blur', () => onerileriGoster(false))
  girdi.addEventListener('keydown', (e) => {
    const acik = !oneriKutusu.hidden
    if (e.key === 'ArrowDown' && acik) { e.preventDefault(); etkinYap(etkin + 1) }
    else if (e.key === 'ArrowUp' && acik) { e.preventDefault(); etkinYap(etkin - 1) }
    else if ((e.key === 'Enter' || e.key === 'Tab') && acik && etkin >= 0) { e.preventDefault(); sec(etkin) }
    else if (e.key === 'Enter') { e.preventDefault(); onerileriGoster(false); calistir(true) }
    else if (e.key === 'Escape') {
      e.preventDefault()
      if (acik) onerileriGoster(false)
      else if (!panel.hidden) kapat()
      else girdi.blur()
    }
  })

  function kapat() {
    panel.hidden = true
  }

  return {
    kutu,
    panel,
    // Ctrl+F: kutuya odaklan, yazılanı seç
    odakla() {
      girdi.focus()
      try { girdi.select() } catch { /* sorun değil */ }
    },
    kapat,
    // Kapsam değişti (başka sunucu, Ana sayfa): kutu boşalır, panel kapanır, süren arama yok sayılır
    sifirla() {
      clearTimeout(zamanlayici)
      sira++
      girdi.value = ''
      temizle()
      durum.textContent = ''
      onerileriGoster(false)
      kapat()
    },
    acikMi: () => !panel.hidden,
    destroy() {
      kapandi = true
      clearTimeout(zamanlayici)
      kutu.remove()
      panel.remove()
    },
  }
}
