// Ortak pencere kalıbı: uygulamadaki bütün pencereler (sunucu oluştur, katıl, kanal ekle,
// profil, ayarlar, mikrofon testi, tuş seçimi) bu tek fonksiyonla kurulur.
//
//   ┌─────────────────────────────┐
//   │ Başlık (20px)            ×  │  .modal-head
//   │ ...gövde...                 │  .modal-body (uzunsa kendi içinde kayar)
//   │ hata metni                  │  .error
//   ├─────────────────────────────┤
//   │ Vazgeç            [Kaydet]  │  .modal-foot (ayrı renkte şerit)
//   └─────────────────────────────┘
//
// Kapanma: X, Vazgeç, Esc ya da pencerenin dışına (arka plana) tıklama.
// Kaydederken (ana düğmenin işi sürerken) Esc ve arka plan tıklaması YOK SAYILIR: yanlışlıkla
// kapanıp yarım kalmasın diye. X ve Vazgeç yine kapatır (bilerek basılan düğmeler); bu durumda
// kayıt arkada biter, sonucu uygulanır; kayıt başarısız olursa hata bildirim (toast) olarak çıkar.
// Tam ekrandayken Esc'e dokunmayız: tam ekrandan çıkmak tarayıcının işi.
//
// Odak: açılınca ilk alana gider (ya da istenirse başlığa), Tab pencerenin içinde döner,
// kapanınca açan öğeye geri döner.
//
// Üst üste pencere (ör. ayarların üstünde tuş seçimi): üstteki pencerenin perdesi saydamdır,
// arka plan ikinci kez kararmaz (.ust-uste).

import { toast } from './layout.js'

// Açık pencereler; en üstteki dizinin sonunda. Esc ve Tab yalnız en üsttekini ilgilendirir.
const yigin = []
let sayac = 0 // başlık id'leri benzersiz olsun (aria-labelledby için)

// --- Pencerelerdeki kutu altı hatalar (giriş kartındaki kalıbın aynısı) ---
// formAlani(etiket, kutu) etiketi kutuya for/id ile bağlar ve kutunun hemen altına (başta boş)
// bir hata satırı kurar. Ana düğmenin işi { alan: kutu, metin } dönerse metin bu satıra yazılır,
// kutu kırmızı kenar (aria-invalid) alır ve odak kutuya gider.
const hataSatirlari = new WeakMap() // kutu → hata satırı
let alanSayac = 0 // kutu id'leri benzersiz olsun

// Döner: { etiket, input, hata } (pencereye bu sırayla konur)
export function formAlani(etiketYazi, input) {
  if (!input.id) input.id = `pencere-alan-${++alanSayac}`
  const etiket = document.createElement('label')
  etiket.htmlFor = input.id
  etiket.textContent = etiketYazi
  const hata = document.createElement('p')
  hata.className = 'field-error'
  hata.id = `${input.id}-hata`
  const onceki = input.getAttribute('aria-describedby')
  input.setAttribute('aria-describedby', onceki ? `${onceki} ${hata.id}` : hata.id)
  hataSatirlari.set(input, hata)
  input.addEventListener('input', () => alanHatasi(input, '')) // yazmaya başlayınca hata kalkar
  return { etiket, input, hata }
}

// Kutunun hata satırına metni yazar (boşsa temizler); kutu formAlani ile kurulmadıysa false döner
function alanHatasi(input, metin) {
  const satir = hataSatirlari.get(input)
  if (!satir) return false
  satir.textContent = metin ?? ''
  if (metin) input.setAttribute('aria-invalid', 'true')
  else input.removeAttribute('aria-invalid')
  return true
}

// Klavyeyle odaklanabilen öğeler (gizli ya da kapalı olanlar hariç)
function odaklanabilenler(kart) {
  const secici = 'button, input, select, textarea, a[href], [tabindex]:not([tabindex="-1"])'
  return [...kart.querySelectorAll(secici)].filter((e) => !e.disabled && !e.closest('[hidden]'))
}

// Tek bir klavye dinleyicisi bütün pencerelere yeter (ilk pencere açılınca kurulur)
let dinleyiciKuruldu = false
function dinleyiciyiKur() {
  if (dinleyiciKuruldu) return
  dinleyiciKuruldu = true
  window.addEventListener('keydown', (e) => {
    // Başka yoldan sayfadan sökülmüş pencereler varsa listeden at (güvenlik için)
    for (let i = yigin.length - 1; i >= 0; i--) if (!yigin[i].arka.isConnected) yigin.splice(i, 1)
    const ust = yigin.at(-1)
    if (!ust || e.defaultPrevented) return // başkası (ör. tuş seçimi) bu tuşu zaten işledi
    if (e.key === 'Escape') {
      if (document.fullscreenElement) return // tam ekrandan çıkış tarayıcıya kalsın
      e.preventDefault()
      ust.escIle()
    } else if (e.key === 'Tab') {
      ust.tabIle(e)
    }
  })
}

// baslik: pencere başlığı (metin)
// govde: HTMLElement dizisi (ortadaki içerik)
// birincil: { yazi, tik } -> sağdaki yeşil düğme. tik() hata metni dönerse pencere açık kalır
//           ve metin gösterilir; null/boş dönerse pencere kapanır. Verilmezse yeşil düğme olmaz.
//           Hata bir kutuyla ilgiliyse tik() { alan: kutu, metin } dönebilir: metin kutunun altına yazılır
//           (kutu formAlani ile kurulmuş olmalı; değilse metin genel hata satırına düşer).
// ikincil: soldaki düğmenin yazısı ('Vazgeç' varsayılan; ayarlarda 'Kapat')
// onKapat: pencere hangi yolla kapanırsa kapansın bir kez çağrılır (temizlik için)
// genis: true ise pencere daha geniş açılır (ayarlar gibi uzun pencereler)
// enterIleKaydet: true ise tek satırlık yazı kutusunda Enter ana düğmeye basar (küçük pencereler;
//                 çok satırlı kutuda Enter yeni satırdır, dokunmayız)
// tehlikeli: true ise ana düğme yeşil değil kırmızıdır (ör. "Çıkış yap" onayı)
// odakBasliga: true ise açılınca odak ilk alana değil başlığa gider (ayarlar gibi çok alanlı pencereler)
// Döner: { arka, kart, govde, hata, kapat, anaDugme }
export function createModalShell({ baslik, govde = [], birincil = null, ikincil = 'Vazgeç', onKapat = null, genis = false, enterIleKaydet = false, tehlikeli = false, odakBasliga = false }) {
  dinleyiciyiKur()
  // Altta hâlâ açık bir pencere var mı? Varsa bu pencerenin perdesi saydam olur (çift karartma olmasın)
  const ustUste = yigin.some((k) => k.arka.isConnected)
  const oncekiOdak = document.activeElement // kapanınca buraya döneceğiz

  // Arka plan (yarı saydam perde) ve pencere kartı
  const arka = document.createElement('div')
  arka.className = ustUste ? 'modal-back ust-uste' : 'modal-back'
  const kart = document.createElement('div')
  kart.className = genis ? 'modal-card wide' : 'modal-card'
  kart.setAttribute('role', 'dialog')
  kart.setAttribute('aria-modal', 'true')
  kart.tabIndex = -1 // hiç alan yoksa odak kartın kendisine gider

  // Üst: başlık + X
  const ust = document.createElement('div')
  ust.className = 'modal-head'
  const h = document.createElement('h2')
  h.className = 'modal-title'
  h.id = `modal-baslik-${++sayac}`
  h.textContent = baslik
  kart.setAttribute('aria-labelledby', h.id)
  const x = document.createElement('button')
  x.type = 'button'
  x.className = 'modal-x'
  x.setAttribute('aria-label', 'Kapat')
  x.textContent = '×'
  ust.append(h, x)

  // Orta: içerik + hata satırı
  const govdeKutu = document.createElement('div')
  govdeKutu.className = 'modal-body'
  const hata = document.createElement('p')
  hata.className = 'error'
  govdeKutu.append(...govde, hata)

  // Alt şerit: solda Vazgeç/Kapat, sağda yeşil ana düğme
  const alt = document.createElement('div')
  alt.className = 'modal-foot'
  const vazgec = document.createElement('button')
  vazgec.type = 'button'
  vazgec.className = 'secondary'
  vazgec.textContent = ikincil
  alt.appendChild(vazgec)
  let anaDugme = null
  if (birincil) {
    anaDugme = document.createElement('button')
    anaDugme.type = 'button'
    if (tehlikeli) anaDugme.className = 'danger'
    anaDugme.textContent = birincil.yazi
    alt.appendChild(anaDugme)
  }

  kart.append(ust, govdeKutu, alt)
  arka.appendChild(kart)
  document.body.appendChild(arka)

  let kapandi = false
  let kaydediyor = false // ana düğmenin işi sürüyor mu

  function kapat() {
    if (kapandi) return
    kapandi = true
    arka.remove()
    const sira = yigin.indexOf(kayit)
    if (sira >= 0) yigin.splice(sira, 1)
    onKapat?.()
    // Odak, pencereyi açan öğeye döner. O öğe bu arada yeniden çizildiyse (ör. kanal paneli)
    // aynı odak anahtarlı (data-odak) yeni öğeye döner.
    let donulecek = oncekiOdak
    const anahtar = oncekiOdak?.dataset?.odak
    if (!donulecek?.isConnected && anahtar) {
      donulecek = [...document.querySelectorAll('[data-odak]')].find((e) => e.dataset.odak === anahtar)
    }
    if (donulecek?.isConnected && typeof donulecek.focus === 'function') donulecek.focus()
  }

  x.onclick = kapat
  vazgec.onclick = kapat

  // Arka plana tıklama: hem basma hem bırakma arka planda olmalı
  // (pencerenin içinde yazı seçerken fare dışarı kayınca kapanmasın)
  let arkadaBasildi = false
  arka.addEventListener('mousedown', (e) => { arkadaBasildi = e.target === arka })
  arka.addEventListener('click', (e) => {
    if (e.target === arka && arkadaBasildi && !kaydediyor) kapat()
    arkadaBasildi = false
  })

  if (anaDugme) {
    anaDugme.onclick = async () => {
      if (kaydediyor) return // çift tıklama ikinci kaydı başlatmasın
      kaydediyor = true
      anaDugme.disabled = true
      hata.textContent = ''
      // Önceki denemenin kutu hataları temizlenir
      kart.querySelectorAll('[aria-invalid="true"]').forEach((k) => alanHatasi(k, ''))
      let sonuc
      try {
        sonuc = await birincil.tik()
      } catch (e) {
        // Beklenmeyen hata da hata metni gibi gösterilir (sessizce kaybolmasın)
        sonuc = e?.message || 'Bir hata oluştu'
      } finally {
        kaydediyor = false
        anaDugme.disabled = false
      }
      const kutu = sonuc?.alan ?? null // hata hangi kutuyla ilgili (yoksa genel)
      const metin = kutu ? sonuc.metin : sonuc
      if (kapandi) {
        // Bu arada X/Vazgeç ile kapatıldı: hata varsa pencere yok, bildirimle söyleriz
        if (metin) toast(metin, 'hata')
        return
      }
      if (!metin) kapat()
      else if (kutu && alanHatasi(kutu, metin)) kutu.focus()
      else hata.textContent = metin
    }
  }

  // Enter ile kaydet: yalnız tek satırlık yazı kutularında (onay kutusu, düğme, textarea hariç).
  // Yazı birleştirirken (IME, ör. Japonca klavye) basılan Enter harfi onaylar; göndermez.
  if (enterIleKaydet && anaDugme) {
    const yaziTurleri = ['text', 'email', 'password', 'search', 'url', 'tel', 'number']
    kart.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || e.isComposing || e.defaultPrevented) return
      const hedef = e.target
      if (!(hedef instanceof HTMLInputElement) || !yaziTurleri.includes(hedef.type)) return
      e.preventDefault()
      anaDugme.click()
    })
  }

  // Yığındaki kaydımız: klavye dinleyicisi en üstteki pencere için bunları çağırır
  const kayit = {
    arka,
    escIle() { if (!kaydediyor) kapat() },
    // Tab pencerenin içinde döner: sondan başa, Shift+Tab ile baştan (ya da başlıktan) sona
    tabIle(e) {
      const liste = odaklanabilenler(kart)
      if (liste.length === 0) { e.preventDefault(); kart.focus(); return }
      const ilk = liste[0]
      const son = liste.at(-1)
      const simdiki = document.activeElement
      const icerde = kart.contains(simdiki)
      // Odak listede olmayan bir öğedeyse (ör. açılışta odaklanan başlık, tabIndex -1) Shift+Tab
      // tarayıcıya bırakılırsa pencereden dışarı kaçardı: sona döndür
      const listede = liste.includes(simdiki)
      if (e.shiftKey && (simdiki === ilk || !icerde || !listede)) { e.preventDefault(); son.focus() }
      else if (!e.shiftKey && (simdiki === son || !icerde)) { e.preventDefault(); ilk.focus() }
    },
  }
  yigin.push(kayit)

  // İlk odak: istenirse başlık (tabIndex -1: kod odaklar, Tab sırasına girmez);
  // yoksa ilk yazı/seçim alanı; o da yoksa kartın kendisi
  if (odakBasliga) {
    h.tabIndex = -1
    h.focus()
  } else {
    const ilkAlan = odaklanabilenler(govdeKutu).find((e) => e.matches('input, select, textarea'))
    ;(ilkAlan ?? kart).focus()
  }

  return { arka, kart, govde: govdeKutu, hata, kapat, anaDugme }
}
