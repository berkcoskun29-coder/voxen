// Mikrofon testi penceresi: canlı seviye çubuğu, 5 sn kayıt + dinleme, gürültü engelleme anahtarı.
import { openMic, createVoicePipeline, MIC_MESSAGES } from '../voice/pipeline.js'
import { getSettings, updateSettings, onSettingsChange } from '../settings.js'
import { createModalShell } from './modal.js'

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
  // Çubuğun üstünde başlık + seçili mikrofonun adı (soluk)
  const mikAdi = el('span', 'mic-name', 'Varsayılan mikrofon')
  const mikSatiri = el('div', 'mic-row')
  mikSatiri.append(el('span', 'mic-title', 'Konuş, çubuk dolsun'), mikAdi)
  const cubukDis = el('div', 'level-bar')
  const cubuk = el('div', 'level-fill')
  cubukDis.appendChild(cubuk)

  // Gürültü engelleme anahtarı
  const satir = el('div', 'check-row')
  const kutu = document.createElement('input')
  kutu.type = 'checkbox'; kutu.id = 'mic-ns'; kutu.checked = getNoiseSuppressionPref()
  const etiket = el('label', '', 'Gürültü engelleme')
  etiket.htmlFor = 'mic-ns'
  satir.append(kutu, etiket)

  // Aynı ayar Ayarlar penceresinde de var: orada değişirse kutu ve canlı hat da değişsin
  const ayarDinlemeyiBirak = onSettingsChange((yeni) => {
    if (kutu.checked === yeni.noiseSuppression) return // değişiklik bu kutudan geldi
    kutu.checked = yeni.noiseSuppression
    hat?.setNoiseSuppression(yeni.noiseSuppression)
  })

  const kayitBtn = el('button', '', '5 sn kaydet ve dinle')
  kayitBtn.type = 'button'
  const kayitlar = el('div', 'recordings') // arka arkaya kayıtlar burada birikir

  // Ortak pencere kalıbı: sol altta "Kapat"; X, Esc ve arka plan da kapatır.
  // Hangi yolla kapanırsa kapansın temizlik (mikrofonu kapatma vb.) onKapat'ta yapılır.
  const kabuk = createModalShell({
    baslik: 'Mikrofon testi',
    ikincil: 'Kapat',
    govde: [mikSatiri, cubukDis, satir, kayitBtn, el('p', 'mic-note', 'Kaydettiğin ses sana geri çalınır.'), kayitlar],
    onKapat: () => temizle(),
  })
  const hata = kabuk.hata // hata satırı kalıbın içinde hazır

  let hat = null
  let raf = 0
  let kapandi = false
  let kaydedici = null
  let kayitZamanlayici = 0
  const urls = []

  // Pencere kapanırken her şeyi temizle
  function temizle() {
    if (kapandi) return
    kapandi = true
    ayarDinlemeyiBirak()
    cancelAnimationFrame(raf)
    clearTimeout(kayitZamanlayici)
    if (kaydedici && kaydedici.state !== 'inactive') kaydedici.stop()
    hat?.close()
    urls.forEach((u) => URL.revokeObjectURL(u))
  }

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
      const ad = akis.getAudioTracks?.()[0]?.label
      if (ad) { mikAdi.textContent = ad; mikAdi.title = ad }
      // Hat kurulumu başarısız olursa createVoicePipeline mikrofonu kendisi durdurur
      hat = await createVoicePipeline(akis, { noiseSuppression: kutu.checked })
      if (kapandi) { hat.close(); return }
      hat.setNoiseSuppression(kutu.checked) // kurulum sırasında anahtar değişmiş olabilir
      raf = requestAnimationFrame(ciz)
    } catch (e) {
      hata.textContent = MIC_MESSAGES[e?.code] ?? 'Mikrofon açılamadı. Başka bir uygulama kullanıyor olabilir.'
      kayitBtn.disabled = true
    }
  })()

  return { close: () => kabuk.kapat() }
}
