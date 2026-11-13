// Kısa uyarı sesleri. Ses dosyası yok: tonlar Web Audio ile (OscillatorNode) üretilir.

// Her sesin notaları: [frekans (Hz), süre (sn)]. Görev 8 'ptt-on' / 'ptt-off' kullanacak.
export const BEEPS = {
  join: [[523, 0.08], [784, 0.12]], // yükselen iki nota: katıldın
  leave: [[784, 0.08], [523, 0.12]], // alçalan iki nota: ayrıldın
  'ptt-on': [[880, 0.05]], // tek kısa ince ses: konuşma açıldı
  'ptt-off': [[620, 0.05]], // tek kısa kalın ses: konuşma kapandı
  bildirim: [[740, 0.07], [988, 0.16]], // kısa, yumuşak iki nota: yeni DM ya da @bahsetme (src/notify.js)
}

let ctx = null // tek ses bağlamı, ilk bipte açılır

// deps sadece testler içindir (sahte AudioContext)
export function playBeep(ad, deps = {}) {
  const notalar = BEEPS[ad]
  if (!notalar) return false
  const Ctx = deps.AudioContext ?? globalThis.AudioContext
  if (!Ctx) return false // tarayıcı desteklemiyorsa sessiz geç
  try {
    if (deps.AudioContext) ctx = new Ctx()
    else ctx ??= new Ctx()
    if (ctx.state === 'suspended') ctx.resume?.()
    let t = ctx.currentTime
    for (const [frekans, sure] of notalar) {
      const osc = ctx.createOscillator()
      const ses = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = frekans
      // Tık sesi olmasın diye yavaşça aç-kapa
      ses.gain.setValueAtTime(0, t)
      ses.gain.linearRampToValueAtTime(0.15, t + 0.01)
      ses.gain.linearRampToValueAtTime(0, t + sure)
      osc.connect(ses)
      ses.connect(ctx.destination)
      osc.start(t)
      osc.stop(t + sure)
      t += sure
    }
    return true
  } catch {
    return false // ses çalamadık diye uygulama bozulmasın
  }
}
