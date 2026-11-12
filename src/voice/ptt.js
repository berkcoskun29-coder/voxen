// Bas-konuş / sesle algılama denetleyicisi: mikrofon kapısının açılıp kapanacağına karar verir.
// Kapıyı kendisi sürmez; kapı her değiştiğinde onGate(açıkMı) çağırır.
//
// ptt modu: ayarlanan tuş basılıyken kapı açık, bırakınca kapalı.
//   Tuş kodları KeyboardEvent.code'dur ("KeyV"). Tuş yoksa (null) kapı hep kapalı.
//   Tarayıcıda window keydown/keyup dinlenir. Masaüstünde (Tauri) ise tarayıcı dinleyicileri kapalıdır
//   (listen:false); tuşları Rust'taki sistem çapında dinleyici `ptt-key` olayıyla bildirir (connectDesktopPtt).
//   Yazı yazılan bir kutuda (input/textarea/select/contenteditable) YAZDIRILABİLİR bir tuş
//   (harf, rakam, boşluk, noktalama) bas-konuş sayılmaz; yoksa sohbete "v" yazarken mikrofon açılırdı.
//   F-tuşları, Ctrl vb. yazı kutusundayken de çalışır. Tuşu BIRAKMA (keyup) her zaman işlenir,
//   böylece kapı açık takılı kalmaz. Tuş seçme penceresi açıkken (setSuspended) tuşlar yok sayılır.
// vad modu: getLevel() 50 ms'de bir okunur; seviye eşiğin üstündeyse açık,
//   altına düşünce 300 ms (hangover) sonra kapanır ki kelime sonları kesilmesin.
export const VAD_POLL_MS = 50
export const VAD_HANGOVER_MS = 300

// "KeyV" -> "V", "Digit1" -> "1", "Space" -> "Boşluk" (ayarlarda göstermek için)
export function keyLabel(code) {
  if (!code) return ''
  if (code.startsWith('Key')) return code.slice(3)
  if (code.startsWith('Digit')) return code.slice(5)
  if (code === 'Space') return 'Boşluk'
  return code
}

// Bu tuş kodu yazı kutusuna karakter yazar mı? (KeyboardEvent.code)
export function isPrintableCode(code) {
  return /^(Key|Digit|Numpad|Bracket)/.test(code) ||
    ['Space', 'Comma', 'Period', 'Slash', 'Semicolon', 'Quote', 'Backslash', 'Minus', 'Equal', 'Backquote', 'IntlBackslash'].includes(code)
}

// Olayın hedefi yazı yazılan bir alan mı?
function yaziAlani(hedef) {
  const tag = hedef?.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || !!hedef?.isContentEditable
}

// Bas-konuş tuşuna basış/bırakış bipi: sadece ptt modunda ve susturulmamış/sağır değilken
export function pttBeepName(open, { mode, muted, deafened }) {
  if (mode !== 'ptt' || muted || deafened) return null
  return open ? 'ptt-on' : 'ptt-off'
}

export const PTT_HOOK_ERROR_TEXT = 'Bas-konuş tuşu dinlenemiyor'
// Kanca hatasında ses panelinde bu not da görünür (yönetici olarak çalışan oyunun tuşlarını
// normal yetkideki program göremez)
export const PTT_ADMIN_HINT = "Oyun yönetici olarak çalışıyorsa Voxen'i de yönetici olarak çalıştır."

// Ses panelindeki kırmızı ipucu (yoksa null). hookError: masaüstünde klavye kancası çalışmıyor.
export function pttHintText({ mode, pttKey, hookError = false }) {
  if (mode !== 'ptt') return null
  if (hookError) return `${PTT_HOOK_ERROR_TEXT}. ${PTT_ADMIN_HINT}`
  return pttKey ? null : 'Bas-konuş tuşu seçilmedi'
}

export class PttController {
  // getLevel / threshold sadece vad modunda kullanılır (getLevel: () => 0..1)
  constructor({ mode = 'ptt', key = null, onGate, getLevel = () => 0, threshold = 0.02, listen = true } = {}) {
    this.mode = mode
    this.key = key
    this.onGate = onGate ?? (() => {})
    this.getLevel = getLevel
    this.threshold = threshold
    this.open = false // kapı şu an açık mı
    this.pressed = false // ptt tuşu şu an basılı mı
    this.suspended = false
    this.lastLoud = 0 // vad: en son yüksek sesin zamanı
    this.timer = null
    this.onKeyChange = null // tuş değişince çağrılır (masaüstünde Rust'a bildirmek için)

    // Tarayıcı dinleyicileri (testte / Tauri'de listen:false verilebilir)
    this.onKeyDown = (e) => {
      if (e.repeat) return
      if (yaziAlani(e.target) && isPrintableCode(e.code)) return // yazarken tetikleme
      this.handleKey(e.code, true)
    } // tuş basılı tutulunca tekrar gelen olayları atla
    this.onKeyUp = (e) => this.handleKey(e.code, false)
    this.onBlur = () => this.handleBlur()
    this.listening = listen && typeof window !== 'undefined'
    if (this.listening) {
      window.addEventListener('keydown', this.onKeyDown)
      window.addEventListener('keyup', this.onKeyUp)
      window.addEventListener('blur', this.onBlur)
    }
    this._startVad()
  }

  isOpen() { return this.open }

  // Kapı durumu değiştiyse haber ver (aynıysa sessiz kal)
  _set(acik) {
    if (acik === this.open) return
    this.open = acik
    this.onGate(acik)
  }

  _sync() {
    if (this.mode === 'ptt') this._set(this.pressed && !!this.key)
    // vad modunda kapıyı zamanlayıcı yönetir
  }

  _startVad() {
    clearInterval(this.timer)
    this.timer = null
    if (this.mode !== 'vad') return
    this.timer = setInterval(() => {
      const simdi = Date.now()
      if (this.getLevel() >= this.threshold) {
        this.lastLoud = simdi
        this._set(true)
      } else if (this.open && simdi - this.lastLoud >= VAD_HANGOVER_MS) {
        this._set(false)
      }
    }, VAD_POLL_MS)
  }

  setMode(mode) {
    this.mode = mode === 'vad' ? 'vad' : 'ptt'
    this.pressed = false
    this._set(false) // mod değişince kapı kapanır; yeni mod kendi kararını verir
    this._startVad()
  }

  setKey(key) {
    this.key = key || null
    this.pressed = false
    this._sync()
    this.onKeyChange?.(this.key)
  }

  setThreshold(t) { this.threshold = t }
  setGetLevel(fn) { this.getLevel = fn }

  // Tuş seçme penceresi açıkken true: tuşlar bas-konuşu tetiklemesin
  setSuspended(b) {
    this.suspended = !!b
    if (this.suspended) { this.pressed = false; this._sync() }
  }

  handleKey(code, isDown) {
    if (this.mode !== 'ptt' || !this.key || code !== this.key) return
    if (this.suspended && isDown) return
    this.pressed = !!isDown
    this._sync()
  }

  // Masaüstündeki sistem çapında dinleyiciden gelen tuş. Voxen penceresi öndeyken ve bir yazı kutusu
  // seçiliyken yazdırılabilir tuş bas-konuş sayılmaz (sohbete "v" yazarken mikrofon açılmasın).
  // Pencere arkadayken (oyun öndeyken) her zaman sayılır. Bırakma her zaman işlenir.
  handleExternalKey(code, isDown) {
    if (isDown && typeof document !== 'undefined' && document.hasFocus() &&
        yaziAlani(document.activeElement) && isPrintableCode(code)) return
    this.handleKey(code, isDown)
  }

  // Pencere odağı kaybolunca tuşun bırakıldığını göremeyiz: güvenli tarafta kal, kapıyı kapat
  handleBlur() {
    this.pressed = false
    this._sync()
  }

  dispose() {
    clearInterval(this.timer)
    this.timer = null
    if (this.listening) {
      window.removeEventListener('keydown', this.onKeyDown)
      window.removeEventListener('keyup', this.onKeyUp)
      window.removeEventListener('blur', this.onBlur)
      this.listening = false
    }
    this.pressed = false
    this._set(false)
  }
}

// Masaüstü (Tauri) bağlantısı. api: { listen, invoke } (desktop.js loadTauriApi; testte sahtesi).
// Denetleyici listen:false ile kurulmalıdır: tarayıcının kendi tuş olayları ve pencere odağı kaybı
// yok sayılır (oyun öndeyken de konuşulabilsin, aynı tuş iki kez işlenmesin).
// Seçili tuş Rust'a set_ptt_key ile bildirilir; Rust yalnızca o tuşun basma/bırakma değişimlerini yollar.
// onHookError(mesaj): Rust'taki klavye kancası kurulamadıysa ya da durduysa çağrılır
// (açılışta zaten olmuş bir hata ptt_hook_status ile sorulur). Dönen fonksiyon bağlantıyı keser
// ve Rust'a set_ptt_key(null) gönderir.
export async function connectDesktopPtt(ptt, { listen, invoke }, { onHookError } = {}) {
  const bildir = (code) => { Promise.resolve(invoke('set_ptt_key', { code: code ?? null })).catch(() => {}) }
  ptt.onKeyChange = bildir
  bildir(ptt.key)
  const birakanlar = [
    await listen('ptt-key', (olay) => {
      const { code, down } = olay.payload ?? {}
      ptt.handleExternalKey(code, !!down)
    }),
    await listen('ptt-hook-error', (olay) => onHookError?.(String(olay.payload ?? ''))),
  ]
  try {
    const hata = await invoke('ptt_hook_status')
    if (hata) onHookError?.(String(hata))
  } catch { /* eski sürüm ya da komut yok: sorun değil */ }
  return () => {
    birakanlar.forEach((f) => f())
    if (ptt.onKeyChange === bildir) ptt.onKeyChange = null
    bildir(null) // Rust artık hiçbir tuşu dinlemesin (Çıkış ya da oturum sonu)
  }
}
