// Ayarlar penceresi + bas-konuş tuşu seçme penceresi.
// Her değişiklik hemen kaydedilir (src/settings.js); canlı oturuma uygulamayı app.js yapar.
import { getSettings, updateSettings, BITRATE_MIN, BITRATE_MAX, UPLOAD_SECENEKLERI } from '../settings.js'
import { keyLabel } from '../voice/ptt.js'
import { isTauri } from '../desktop.js'
import { openMicTest } from './micTest.js'

function el(tag, cls, text) {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (text) e.textContent = text
  return e
}

let ayarPenceresi = null // aynı anda en fazla bir ayarlar penceresi
let tusPenceresi = null // aynı anda en fazla bir tuş seçme penceresi

// "Bas-konuş tuşunu seç" penceresi: basılan ilk tuş kaydedilir, Esc iptal eder.
// Pencere açıkken ptt tuşları yok sayılır (setSuspended), yoksa seçerken kapı açılırdı.
export function askPttKey(ptt, onDone) {
  if (tusPenceresi) return tusPenceresi
  const arka = el('div', 'modal-back')
  const kart = el('div', 'card')
  kart.append(el('h1', '', 'Bas-konuş tuşunu seç — bir tuşa bas'), el('p', 'muted', 'Esc ile vazgeçebilirsin.'))
  arka.appendChild(kart)
  document.body.appendChild(arka)
  ptt?.setSuspended(true)

  function bitir(code) {
    window.removeEventListener('keydown', basinca, true)
    arka.remove()
    tusPenceresi = null
    ptt?.setSuspended(false)
    if (code) { updateSettings({ pttKey: code }); ptt?.setKey(code) }
    onDone?.(code)
  }
  function basinca(e) {
    e.preventDefault()
    e.stopPropagation()
    if (e.repeat) return
    bitir(e.code === 'Escape' ? null : e.code)
  }
  window.addEventListener('keydown', basinca, true) // yakalama aşamasında: başkası görmeden alırız
  tusPenceresi = arka
  return arka
}

// Bas-konuş modundayız ve tuş seçilmemişse pencereyi aç (ilk katılışta / ayarlar açılırken)
export function askPttKeyIfNeeded(ptt, onDone) {
  const s = getSettings()
  if (s.mode !== 'ptt' || s.pttKey) return null
  return askPttKey(ptt, onDone)
}

// Etiket + kontrol satırı
function satir(etiket, ...kontroller) {
  const r = el('div', 'row')
  r.append(el('label', '', etiket), ...kontroller)
  return r
}

async function cihazlariDoldur(girisSec, cikisSec, kameraSec, s) {
  try {
    const liste = await navigator.mediaDevices.enumerateDevices()
    for (const [tur, sec, secili, ad] of [
      ['audioinput', girisSec, s.inputDeviceId, 'Mikrofon'],
      ['audiooutput', cikisSec, s.outputDeviceId, 'Hoparlör'],
      ['videoinput', kameraSec, s.cameraDeviceId, 'Kamera'],
    ]) {
      let n = 0
      for (const d of liste.filter((x) => x.kind === tur)) {
        n++
        const o = el('option', '', d.label || `${ad} ${n}`) // izin verilmeden etiket boş gelir
        o.value = d.deviceId
        sec.appendChild(o)
      }
      sec.value = secili ?? ''
      if (sec.value !== (secili ?? '')) sec.value = '' // cihaz artık takılı değil
    }
  } catch { /* cihaz listesi alınamadı: sadece "Varsayılan" kalır */ }
}

// ptt: PttController. onProfile: profil penceresini açar.
export function openSettings({ ptt, onProfile } = {}) {
  if (ayarPenceresi?.isConnected) return { close: () => ayarPenceresi?.remove() } // zaten açık
  const s = getSettings()
  const arka = el('div', 'modal-back')
  const kart = el('div', 'card')
  const kapat = el('button', 'secondary', 'Kapat')
  kapat.type = 'button'
  kapat.onclick = () => arka.remove()
  ayarPenceresi = arka

  // Profil
  const profilBtn = el('button', 'secondary', 'Profil')
  profilBtn.type = 'button'
  profilBtn.onclick = () => { arka.remove(); onProfile?.() }

  // Mod
  const mod = document.createElement('select')
  mod.dataset.ayar = 'mod'
  for (const [v, y] of [['ptt', 'Bas-konuş'], ['vad', 'Sesle algılama']]) {
    const o = el('option', '', y)
    o.value = v
    mod.appendChild(o)
  }
  mod.value = s.mode

  // Tuş ata (yalnız ptt modunda)
  const tusYazi = el('span', 'muted')
  const tusBtn = el('button', 'secondary', 'Tuş ata')
  tusBtn.type = 'button'
  const tusSatiri = satir('Bas-konuş tuşu', tusYazi, tusBtn)
  const tusGoster = () => { tusYazi.textContent = keyLabel(getSettings().pttKey) || 'seçilmedi' }
  tusBtn.onclick = () => askPttKey(ptt, tusGoster)

  // Sesle algılama hassasiyeti (yalnız vad modunda)
  const vad = document.createElement('input')
  vad.type = 'range'; vad.dataset.ayar = 'vad'
  vad.min = '0.005'; vad.max = '0.1'; vad.step = '0.005'; vad.value = String(s.vadThreshold)
  const vadSatiri = satir('Sesle algılama eşiği', vad)
  vadSatiri.dataset.ayar = 'vad-satiri'
  vad.oninput = () => updateSettings({ vadThreshold: Number(vad.value) })

  function modGoster() {
    const m = getSettings().mode
    tusSatiri.hidden = m !== 'ptt'
    vadSatiri.hidden = m !== 'vad'
  }
  mod.onchange = () => { updateSettings({ mode: mod.value }); modGoster(); askPttKeyIfNeeded(ptt, tusGoster) }

  // Gürültü engelleme
  const ns = document.createElement('input')
  ns.type = 'checkbox'; ns.id = 'ayar-ns'; ns.checked = s.noiseSuppression
  ns.onchange = () => updateSettings({ noiseSuppression: ns.checked })
  const nsSatiri = el('div', 'row')
  const nsEtiket = el('label', '', 'Gürültü engelleme')
  nsEtiket.htmlFor = 'ayar-ns'
  nsSatiri.append(ns, nsEtiket)

  // Ses kalitesi: 32–128 kbps, 8'er adım
  const kalite = document.createElement('input')
  kalite.type = 'range'; kalite.dataset.ayar = 'bitrate'
  kalite.min = String(BITRATE_MIN); kalite.max = String(BITRATE_MAX); kalite.step = '8'
  kalite.value = String(s.bitrateKbps)
  const kaliteYazi = el('span', 'muted', `${s.bitrateKbps} kbps`)
  kalite.oninput = () => {
    const yeni = updateSettings({ bitrateKbps: Number(kalite.value) }) // sınır dışı olamaz
    kaliteYazi.textContent = `${yeni.bitrateKbps} kbps`
  }

  // Cihazlar
  const giris = document.createElement('select')
  const cikis = document.createElement('select')
  const kamera = document.createElement('select')
  kamera.dataset.ayar = 'kamera'
  for (const sec of [giris, cikis, kamera]) {
    const o = el('option', '', 'Varsayılan')
    o.value = ''
    sec.appendChild(o)
  }
  giris.onchange = () => updateSettings({ inputDeviceId: giris.value || null })
  cikis.onchange = () => updateSettings({ outputDeviceId: cikis.value || null })
  kamera.onchange = () => updateSettings({ cameraDeviceId: kamera.value || null }) // açıksa app.js canlı geçirir
  const sinkVar = typeof HTMLMediaElement !== 'undefined' && 'setSinkId' in HTMLMediaElement.prototype
  if (!sinkVar) cikis.disabled = true // bu tarayıcı çıkış cihazı seçtirmiyor
  cihazlariDoldur(giris, cikis, kamera, s)

  const girisNot = el('p', 'muted', 'Mikrofon değişikliği bir sonraki sesli kanala katılışta geçerli olur.')
  const cikisNot = el('p', 'muted', sinkVar ? '' : 'Bu tarayıcı hoparlör seçmeyi desteklemiyor.')

  // Görüntü için toplam upload hızı (5/10/20 Mbps)
  const upload = document.createElement('select')
  upload.dataset.ayar = 'upload'
  for (const mbps of UPLOAD_SECENEKLERI) {
    const o = el('option', '', `${mbps} Mbps`)
    o.value = String(mbps)
    upload.appendChild(o)
  }
  upload.value = String(s.uploadMbps)
  upload.onchange = () => updateSettings({ uploadMbps: Number(upload.value) })
  const uploadNot = el('p', 'muted', 'Ekran paylaşımı ve kamera bu hızın bir kısmını kullanır')

  // Ekran paylaşımı kalitesi: bir sonraki paylaşımda geçerli
  const ekranKalite = document.createElement('select')
  ekranKalite.dataset.ayar = 'ekran-kalite'
  for (const [deger, yazi] of [['net', 'Net (1080p, 30 fps)'], ['akici', 'Akıcı (720p, 60 fps)']]) {
    const o = el('option', '', yazi)
    o.value = deger
    ekranKalite.appendChild(o)
  }
  ekranKalite.value = s.screenMode
  ekranKalite.onchange = () => updateSettings({ screenMode: ekranKalite.value })

  // Mikrofon testi
  const testBtn = el('button', 'secondary', 'Mikrofon testi')
  testBtn.type = 'button'
  testBtn.onclick = () => openMicTest()

  const uyari = el('p', 'muted', "Oyunun kendi sesli sohbet tuşunu seçme (ör. CS2/Valorant'ta V)")
  // Masaüstünde: oyun yönetici olarak çalışıyorsa Windows, yönetici olmayan programın tuşu görmesine izin vermez
  const yoneticiNotu = isTauri()
    ? el('p', 'muted', "Oyun yönetici olarak çalışıyorsa ve tuş algılanmıyorsa Voxen'i de yönetici olarak çalıştır.")
    : null
  const dugmeler = el('div', 'buttons')
  dugmeler.appendChild(kapat)

  kart.append(
    el('h1', '', 'Ayarlar'), profilBtn,
    satir('Mod', mod), tusSatiri, vadSatiri,
    nsSatiri,
    satir('Ses kalitesi', kalite, kaliteYazi),
    satir('Giriş cihazı', giris), girisNot,
    satir('Çıkış cihazı', cikis), cikisNot,
    satir('Kamera', kamera),
    satir('Upload hızın', upload), uploadNot,
    satir('Ekran paylaşımı', ekranKalite),
    testBtn, uyari, ...(yoneticiNotu ? [yoneticiNotu] : []), dugmeler,
  )
  arka.appendChild(kart)
  document.body.appendChild(arka)
  tusGoster()
  modGoster()
  askPttKeyIfNeeded(ptt, tusGoster) // ayarlar açılırken tuş yoksa hemen sor
  return { close: () => arka.remove() }
}
