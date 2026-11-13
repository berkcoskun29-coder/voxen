// Kısa uyarı sesleri. Ses dosyası yok: tonlar Web Audio ile (OscillatorNode) üretilir.

// Her sesin notaları: [frekans (Hz), süre (sn)]. Görev 8 'ptt-on' / 'ptt-off' kullanacak.
export const BEEPS = {
  join: [[523, 0.08], [784, 0.12]], // yükselen iki nota: katıldın
  leave: [[784, 0.08], [523, 0.12]], // alçalan iki nota: ayrıldın
  'ptt-on': [[880, 0.05]], // tek kısa ince ses: konuşma açıldı
  'ptt-off': [[620, 0.05]], // tek kısa kalın ses: konuşma kapandı
  bildirim: [[740, 0.07], [988, 0.16]], // kısa, yumuşak iki nota: yeni DM ya da @bahsetme (src/notify.js)
  bekleme: [[440, 0.45], [494, 0.45]], // arayan tarafta yumuşak bekleme tonu (döngüde çalar, bkz. LOOPS)
  zil: [[659, 0.12], [880, 0.12], [659, 0.12], [880, 0.2]], // gelen arama zili: kısa, yükselip inen dört nota (döngüde)
}

// Döngüde çalan sesler: hangi nota dizisi, ne sıklıkla (ms) ve ne kadar yumuşak (ses yüksekliği)
export const LOOPS = {
  bekleme: { nota: 'bekleme', aralikMs: 3000, ses: 0.07 }, // DM araması: "Aranıyor…" sırasında
  zil: { nota: 'zil', aralikMs: 2000, ses: 0.1 }, // DM araması: gelen arama kartı açıkken (src/ui/incomingCall.js)
}

let ctx = null // tek ses bağlamı, ilk bipte açılır

// Notaları sırayla çalar; başlatılan osilatörleri döner (döngüyü erken durdurmak için).
function notalariCal(notalar, deps, yukseklik) {
  const Ctx = deps.AudioContext ?? globalThis.AudioContext
  if (!Ctx) return null // tarayıcı desteklemiyorsa sessiz geç
  if (deps.AudioContext) ctx = new Ctx()
  else ctx ??= new Ctx()
  if (ctx.state === 'suspended') ctx.resume?.()
  let t = ctx.currentTime
  const osilatorler = []
  for (const [frekans, sure] of notalar) {
    const osc = ctx.createOscillator()
    const ses = ctx.createGain()
    osc.type = 'sine'
    osc.frequency.value = frekans
    // Tık sesi olmasın diye yavaşça aç-kapa
    ses.gain.setValueAtTime(0, t)
    ses.gain.linearRampToValueAtTime(yukseklik, t + 0.01)
    ses.gain.linearRampToValueAtTime(0, t + sure)
    osc.connect(ses)
    ses.connect(ctx.destination)
    osc.start(t)
    osc.stop(t + sure)
    osilatorler.push(osc)
    t += sure
  }
  return osilatorler
}

// deps sadece testler içindir (sahte AudioContext)
export function playBeep(ad, deps = {}) {
  const notalar = BEEPS[ad]
  if (!notalar) return false
  try {
    return notalariCal(notalar, deps, 0.15) !== null
  } catch {
    return false // ses çalamadık diye uygulama bozulmasın
  }
}

// Döngülü sesi başlatır (hemen bir kez, sonra her aralikMs'de). Dönen fonksiyon durdurur:
// sayaç temizlenir ve o an çalan notalar da kesilir. Bilinmeyen ad ya da Web Audio yoksa sessiz.
export function startLoop(ad, deps = {}) {
  const dongu = LOOPS[ad]
  if (!dongu) return () => {}
  let calan = []
  const cal = () => {
    try { calan = notalariCal(BEEPS[dongu.nota], deps, dongu.ses) ?? [] } catch { calan = [] }
  }
  cal()
  const sayac = setInterval(cal, dongu.aralikMs)
  let durdu = false
  return () => {
    if (durdu) return
    durdu = true
    clearInterval(sayac)
    for (const osc of calan) {
      try { osc.stop() } catch { /* zaten bitti */ }
    }
    calan = []
  }
}
