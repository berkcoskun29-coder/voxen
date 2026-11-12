// Mikrofon testi penceresi: canlı seviye çubuğu, 5 sn kayıt + dinleme, gürültü engelleme anahtarı.
import { openMic, createVoicePipeline, MIC_MESSAGES } from '../voice/pipeline.js'
import { getSettings, updateSettings } from '../settings.js'

// Gürültü engelleme tercihi artık tek ayar nesnesinde (src/settings.js). Eski adlar uyumluluk için kaldı.
export function getNoiseSuppressionPref() { return getSettings().noiseSuppression }
export function setNoiseSuppressionPref(acik) { updateSettings({ noiseSuppression: !!acik }) }

function el(tag, cls, text) {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (text) e.textContent = text
  return e
}

export function openMicTest() {
  const arka = el('div', 'modal-back')
  const kart = el('div', 'card')
  const baslik = el('h1', '', 'Mikrofon testi')
  const hata = el('p', 'error')
  const cubukDis = el('div', 'level-bar')
  const cubuk = el('div', 'level-fill')
  cubukDis.appendChild(cubuk)

  // Gürültü engelleme anahtarı
  const satir = el('div', 'row')
  const kutu = document.createElement('input')
  kutu.type = 'checkbox'; kutu.id = 'mic-ns'; kutu.checked = getNoiseSuppressionPref()
  const etiket = el('label', '', 'Gürültü engelleme')
  etiket.htmlFor = 'mic-ns'
  satir.append(kutu, etiket)

  const kayitBtn = el('button', '', '5 sn kaydet ve dinle')
  kayitBtn.type = 'button'
  const kayitlar = el('div', 'recordings') // arka arkaya kayıtlar burada birikir
  const kapat = el('button', 'secondary', 'Kapat')
  kapat.type = 'button'
  const dugmeler = el('div', 'buttons')
  dugmeler.appendChild(kapat)
  kart.append(baslik, cubukDis, satir, kayitBtn, kayitlar, hata, dugmeler)
  arka.appendChild(kart)
  document.body.appendChild(arka)

  let hat = null
  let raf = 0
  let kapandi = false
  let kaydedici = null
  let kayitZamanlayici = 0
  const urls = []

  // Pencere kapanırken her şeyi temizle
  function temizle() {
    kapandi = true
    cancelAnimationFrame(raf)
    clearTimeout(kayitZamanlayici)
    if (kaydedici && kaydedici.state !== 'inactive') kaydedici.stop()
    hat?.close()
    urls.forEach((u) => URL.revokeObjectURL(u))
    arka.remove()
  }
  kapat.onclick = temizle

  // Seviye çubuğunu her karede güncelle
  function ciz() {
    if (kapandi || !hat) return
    cubuk.style.width = Math.min(100, Math.round(hat.getLevel() * 300)) + '%'
    raf = requestAnimationFrame(ciz)
  }

  kutu.onchange = () => {
    setNoiseSuppressionPref(kutu.checked)
    hat?.setNoiseSuppression(kutu.checked)
  }

  kayitBtn.onclick = () => {
    if (!hat) return
    const engellemeVardi = kutu.checked
    try {
      kaydedici = new MediaRecorder(hat.outputStream)
      hat.setGate(true) // kapı sadece kayıt gerçekten başlıyorsa açılır
    } catch {
      hata.textContent = 'Kayıt bu tarayıcıda desteklenmiyor'
      return
    }
    kayitBtn.disabled = true
    const buKaydedici = kaydedici
    const parcalar = []
    kaydedici.ondataavailable = (e) => parcalar.push(e.data)
    kaydedici.onstop = () => {
      kayitBtn.disabled = false
      if (kapandi) return
      const url = URL.createObjectURL(new Blob(parcalar, { type: buKaydedici.mimeType }))
      urls.push(url)
      const kutuK = el('div', 'recording')
      kutuK.appendChild(el('span', 'muted', `Kayıt ${urls.length} (engelleme ${engellemeVardi ? 'açık' : 'kapalı'})`))
      const oynatici = document.createElement('audio')
      oynatici.controls = true
      oynatici.src = url
      kutuK.appendChild(oynatici)
      kayitlar.appendChild(kutuK)
      oynatici.play().catch(() => {})
    }
    kaydedici.start()
    kayitZamanlayici = setTimeout(() => { if (buKaydedici.state !== 'inactive') buKaydedici.stop() }, 5000)
  }

  // Mikrofonu aç ve hattı kur
  ;(async () => {
    try {
      const akis = await openMic()
      if (kapandi) { akis.getTracks().forEach((t) => t.stop()); return }
      // Hat kurulumu başarısız olursa createVoicePipeline mikrofonu kendisi durdurur
      hat = await createVoicePipeline(akis, { noiseSuppression: kutu.checked })
      if (kapandi) { hat.close(); return }
      hat.setNoiseSuppression(kutu.checked) // kurulum sırasında anahtar değişmiş olabilir
      raf = requestAnimationFrame(ciz)
    } catch (e) {
      hata.textContent = MIC_MESSAGES[e?.code] ?? 'Mikrofon açılamadı'
      kayitBtn.disabled = true
    }
  })()

  return { close: temizle }
}
