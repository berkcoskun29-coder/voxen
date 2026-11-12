// Mesaj metnindeki web adreslerini tıklanır link yapar (güvenli şekilde).
// Kurallar:
//  - Yalnız http:// ve https:// ile başlayan adresler link olur. javascript:, data:, vbscript:,
//    "//site.com" gibi her şey düz metin kalır.
//  - Link DOM ile kurulur (createElement + textContent); innerHTML HİÇ kullanılmaz,
//    böylece mesajdaki "<img onerror=...>" gibi metinler asla HTML olarak çalışmaz.
//  - Tırnaklar (" ' “ ” ‘ ’ « ») adrese hiç girmez (telefon klavyeleri kıvrık tırnak yazar).
//  - Görünmez/yön değiştiren karakterler (U+200B–U+200F, U+202A–U+202E, U+2060–U+2064, U+FEFF, U+00AD)
//    adrese girmez: adres orada biter, böylece link gizli karakter taşıyamaz.
//  - Adresin sonundaki noktalama (. , ! ? ; :) adrese dahil edilmez:
//    "şuna bak https://a.com." -> link "https://a.com", nokta düz metin.

import { isTauri } from '../desktop.js'

// Adres adayı: önünde harf/rakam olmayan "http://" ya da "https://" ve ardından boşluk,
// < > ve tırnak olmayan karakterler. (?<![\p{L}\p{N}_]) "xhttps://", "çhttps://" gibi kelime
// ortasını dışarıda bırakır (\p{L}: herhangi bir dilde harf; bunun için sondaki "u" bayrağı gerekir).
const ADRES = /(?<![\p{L}\p{N}_])https?:\/\/[^\s<>"'‘’“”«»\u00AD\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF]+/giu

// Sonda adrese dahil edilmeyen işaretler
const SON_ISARETLER = '.,!?;:'

// Kapanış işareti -> açılış eşi
const ESLER = { ')': '(', ']': '[', '}': '{' }
const say = (s, c) => s.split(c).length - 1

// Adayın sonundaki noktalamayı ve eşi olmayan ) ] } işaretini kırpar.
// "Ankara_(il)" içindeki ")" kalır (açılışı var), "(bkz. https://a.com)" içindeki ")" atılır.
function sonuKirp(aday) {
  let s = aday
  for (;;) {
    const son = s.at(-1)
    if (SON_ISARETLER.includes(son)) { s = s.slice(0, -1); continue }
    if (ESLER[son] && say(s, son) > say(s, ESLER[son])) { s = s.slice(0, -1); continue }
    return s
  }
}

// Aday gerçekten geçerli bir http/https adresi mi? Geçerliyse tarayıcının düzelttiği hâlini döner.
function gecerliAdres(s) {
  try {
    const u = new URL(s)
    if ((u.protocol === 'http:' || u.protocol === 'https:') && u.hostname) return u.href
  } catch { /* geçersiz adres: düz metin kalır */ }
  return null
}

// Metni parçalara ayırır: [{ link: false, metin }, { link: true, metin, href }, ...]
// Parçaların metinleri art arda eklenince ilk metin AYNEN geri gelir.
export function linkParcalari(metin) {
  const parcalar = []
  let kalinan = 0 // en son nereye kadar parçaladık
  const ekleMetin = (m) => {
    if (!m) return
    const son = parcalar.at(-1)
    if (son && !son.link) son.metin += m // art arda düz metinleri birleştir
    else parcalar.push({ link: false, metin: m })
  }
  for (const eslesme of metin.matchAll(ADRES)) {
    const adres = sonuKirp(eslesme[0])
    const href = gecerliAdres(adres)
    if (!href) continue // link değil: düz metin olarak sonraki parçaya kalır
    ekleMetin(metin.slice(kalinan, eslesme.index))
    parcalar.push({ link: true, metin: adres, href })
    kalinan = eslesme.index + adres.length
  }
  ekleMetin(metin.slice(kalinan))
  return parcalar
}

// Masaüstü programında (Tauri) target=_blank linki sistemin tarayıcısında açmaz. Bu yüzden orada
// tıklamayı biz yakalar, adresi opener eklentisiyle varsayılan tarayıcıda açarız.
// Eklenti yalnız masaüstünde (dinamik import) yüklenir; web sürümüne yük olmaz.
// Adres zaten yalnız http/https olabilir (yukarıdaki kurallar); eklentinin izni de yalnız bunlara açık.
function linkTiklandi(e) {
  if (!isTauri()) return // web: tarayıcı yeni sekmede açar
  e.preventDefault()
  const adres = e.currentTarget.href
  import('@tauri-apps/plugin-opener')
    .then(({ openUrl }) => openUrl(adres))
    .catch(() => { /* açılamadıysa yapacak bir şey yok; sayfa bozulmasın */ })
}

// Orta tuş (tekerleğe basma): masaüstünde aynı şekilde varsayılan tarayıcıda açılır.
// Web'de tarayıcının kendi davranışı (yeni sekme) kalır.
function linkOrtaTus(e) {
  if (e.button !== 1 || !isTauri()) return
  linkTiklandi(e)
}

// Metni DOM parçası olarak kurar: düz yazılar metin düğümü, adresler <a> olur.
// Link yeni sekmede açılır; rel="noopener noreferrer" açılan sayfanın bizim sayfaya erişmesini engeller.
// Masaüstünde tıklama varsayılan tarayıcıya gider (linkTiklandi).
export function linkliMetin(metin) {
  const parca = document.createDocumentFragment()
  for (const p of linkParcalari(metin)) {
    if (!p.link) {
      parca.appendChild(document.createTextNode(p.metin))
      continue
    }
    const a = document.createElement('a')
    a.className = 'msg-link'
    a.href = p.href
    a.target = '_blank'
    a.rel = 'noopener noreferrer'
    a.textContent = p.metin
    a.addEventListener('click', linkTiklandi)
    a.addEventListener('auxclick', linkOrtaTus)
    parca.appendChild(a)
  }
  return parca
}
