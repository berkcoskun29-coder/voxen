// DM sesli araması (arayan taraf + konuşma): DM başlığındaki 📞 düğmesi, DM'in üstündeki arama paneli
// ve aramanın akışı (zaman aşımı, canlılık, kopma). Kurallar: docs/superpowers/specs/2026-11-13-voxen-dm-arama-design.md §1, §3.
//   createCallButton  -> 📞 düğmesi (pasif durumlarıyla)
//   mountCallPanel    -> panel çizimi ("Aranıyor…" ya da konuşma)
//   createCallFlow    -> akış: başlat, iptal, kapat, user: "arama" olayları, sayaçlar
// Ses oturumunu app.js açar/kapatır (enter = aramayaGir, exit = aramadanCik); burası yalnız akışı yönetir.
import { micIcon, headphonesIcon, hangupIcon, phoneIcon, voiceStateIcon } from './icons.js'
import { avatarTextColor } from './avatarColor.js'
import { mesgulMetni } from '../data/calls.js'

// Süreler (ms). Testler değiştirebilir.
export const callTiming = {
  ringMs: 30000, // cevap gelmezse arama biter (arayanda)
  lostMs: 15000, // bağlantı koptuktan sonra bu kadar düzelmezse arama biter
  firstConnectMs: 30000, // konuşmaya geçildi ama karşıyla hiç bağlanılamadı (mikrofon izni sorulurken de beklenir)
  pingMs: 20000, // aktif aramada canlılık bildirimi
  tickMs: 1000, // süre sayacı
}

export const ARAMA_METINLERI = {
  baslat: 'Sesli arama başlat',
  aramadasin: 'Aramadasın',
  zatenAramada: 'Zaten bir aramadasın.',
  arayamazsin: 'Bu kişiyi şu an arayamazsın.',
  araniyor: 'Aranıyor…',
  baglaniyor: 'Bağlanıyor…',
  koptu: 'Bağlantı koptu, yeniden deneniyor…',
  baglantiKoptu: 'Arama bağlantısı koptu.',
  cevapYok: 'Cevap yok.',
  baslatilamadi: 'Arama başlatılamadı. Tekrar dene.',
}
export const reddettiMetni = (ad) => `${ad} aramayı reddetti.`

// Zaman aşımıyla bırakılan aramanın geç gelen "active" olayı bu süre içinde kabul edilir (ms)
const BIRAKILAN_MS = 60000

// Süre yazısı: 42 sn -> "00:42", 1 saati geçince "1:02:03"
export function sureYazisi(ms) {
  const toplam = Math.max(0, Math.floor((ms || 0) / 1000))
  const s = Math.floor(toplam / 3600)
  const d = Math.floor((toplam % 3600) / 60)
  const sn = toplam % 60
  const iki = (n) => String(n).padStart(2, '0')
  return s > 0 ? `${s}:${iki(d)}:${iki(sn)}` : `${iki(d)}:${iki(sn)}`
}

// startCall hatası -> kullanıcıya gösterilecek metin. Engel kodları (NOT_ALLOWED / BLOCKED_DM) arama
// bağlamında "mesaj gönderemezsin" yerine arama cümlesiyle söylenir (engellenen yine anlamaz).
export function aramaHataMetni(e, ad) {
  if (e?.code === 'BUSY') return mesgulMetni(ad)
  if (e?.code === 'ALREADY_IN_CALL') return ARAMA_METINLERI.zatenAramada
  if (e?.code === 'NOT_ALLOWED' || e?.code === 'BLOCKED_DM') return ARAMA_METINLERI.arayamazsin
  return e?.message || ARAMA_METINLERI.baslatilamadi
}

// ---- 📞 düğmesi ----
// onClick: düğme etkinken basılınca. update({ canSend, inCall, withPeer }):
//   inCall + withPeer (bu kişiyle aramadasın / onu arıyorsun) -> pasif, adı "Aramadasın"
//   inCall, başka bir kişiyle                                -> pasif, baloncukta "Zaten bir aramadasın."
//   canSend false (kutu kapalı)                              -> pasif, baloncukta "Bu kişiyi şu an arayamazsın."
// Pasif düğme disabled değil aria-disabled: odaklanabilir, baloncuğu görünür, tıklama boşa gider.
export function createCallButton({ onClick }) {
  const b = document.createElement('button')
  b.type = 'button'
  b.className = 'icon-btn call-start'
  b.dataset.tipSide = 'bottom' // başlık ekranın tepesinde: baloncuk altta çıksın
  b.appendChild(phoneIcon())
  b.onclick = () => { if (!b.dataset.pasif) onClick?.() }
  function update({ canSend = true, inCall = false, withPeer = false } = {}) {
    const ad = inCall && withPeer ? ARAMA_METINLERI.aramadasin : ARAMA_METINLERI.baslat
    const ipucu = inCall ? (withPeer ? ad : ARAMA_METINLERI.zatenAramada) : canSend ? ad : ARAMA_METINLERI.arayamazsin
    const pasif = inCall || !canSend
    b.setAttribute('aria-label', ad)
    b.dataset.tip = ipucu
    b.title = ipucu
    b.classList.toggle('unavailable', pasif)
    if (pasif) {
      b.dataset.pasif = '1'
      b.setAttribute('aria-disabled', 'true')
    } else {
      delete b.dataset.pasif
      b.removeAttribute('aria-disabled')
    }
  }
  update()
  return { button: b, update }
}

// ---- Panel ----

// Avatar (resim ya da renkli baş harf). konusuyor: yeşil halka; nabiz: "Aranıyor…" atışı;
// durum: { muted, deafened } -> köşede susturma/sağırlaştırma simgesi.
function aramaAvatari(kisi, { konusuyor = false, nabiz = false, durum = null } = {}) {
  const kutu = document.createElement('span')
  kutu.className = 'call-avatar-wrap' + (konusuyor ? ' speaking' : '') + (nabiz ? ' nabiz' : '')
  kutu.dataset.id = kisi?.id ?? ''
  let av
  if (kisi?.avatar_url) {
    av = document.createElement('img')
    av.src = kisi.avatar_url
    av.alt = ''
  } else {
    av = document.createElement('span')
    av.textContent = (Array.from(kisi?.username ?? '')[0] ?? '?').toLocaleUpperCase('tr')
  }
  av.className = 'call-avatar'
  av.style.background = kisi?.color ?? null
  av.style.color = avatarTextColor(kisi?.color)
  kutu.appendChild(av)
  avatariGuncelle(kutu, { konusuyor, durum })
  return kutu
}

// Avatarı yerinde günceller (her saniyelik çizimde düğüm yeniden kurulmaz): konuşan halkası ve
// köşedeki simge. Simge yalnız durum değişince değişir.
function avatariGuncelle(kutu, { konusuyor = false, durum = null } = {}) {
  kutu.classList.toggle('speaking', !!konusuyor)
  const anahtar = durum?.deafened ? 'deafened' : durum?.muted ? 'muted' : ''
  if ((kutu.dataset.durum ?? '') === anahtar) return
  kutu.dataset.durum = anahtar
  kutu.querySelector('.call-avatar-state')?.remove()
  const simge = anahtar ? voiceStateIcon(durum.muted, durum.deafened) : null
  if (simge) {
    const kose = document.createElement('span')
    kose.className = 'call-avatar-state'
    kose.appendChild(simge)
    kutu.appendChild(kose)
  }
}

function yuvarlakDugme(ad, sinif, simge, onClick) {
  const b = document.createElement('button')
  b.type = 'button'
  b.className = 'call-btn ' + sinif
  b.dataset.ad = ad
  b.setAttribute('aria-label', ad)
  b.dataset.tip = ad
  b.title = ad
  b.appendChild(simge)
  b.onclick = () => { if (!b.dataset.pasif) onClick?.() }
  return b
}

// host: panelin konacağı kutu (DM görünümünde başlığın altı, sohbetin üstü).
// handlers: onCancel (İptal), onHangup (Kapat), onToggleMute, onToggleDeafen.
// Dönen ciz(gorunum): null -> panel gizlenir. Aynı aşamada (faz) yeniden çizim yalnız değişen parçaları
// günceller; düğmeler yerinde kalır (klavye odağı her saniye kaybolmasın).
// gorunum: { faz: 'araniyor'|'konusma', self, other, sure, baglanti, konusanlar:Set, ben:{muted,deafened,listenOnly}, karsi }
export function mountCallPanel(host, handlers = {}) {
  let faz = null
  let el = null
  let parca = {}
  host.hidden = true

  function kur(g) {
    el = document.createElement('section')
    el.className = 'call-panel ' + g.faz
    el.setAttribute('aria-label', 'Arama')
    const kisiler = document.createElement('div')
    kisiler.className = 'call-people'
    const ad = document.createElement('div')
    ad.className = 'call-name'
    const durum = document.createElement('div')
    durum.className = 'call-status'
    durum.setAttribute('aria-live', 'polite')
    const dugmeler = document.createElement('div')
    dugmeler.className = 'call-buttons'
    parca = { kisiler, ad, durum }
    if (g.faz === 'araniyor') {
      const iptal = document.createElement('button')
      iptal.type = 'button'
      iptal.className = 'danger call-cancel'
      iptal.textContent = 'İptal'
      iptal.onclick = () => handlers.onCancel?.()
      dugmeler.appendChild(iptal)
      el.append(kisiler, ad, durum, dugmeler)
    } else {
      const sure = document.createElement('div')
      sure.className = 'call-timer'
      parca.sure = sure
      parca.sustur = yuvarlakDugme('Sustur', 'call-mute', micIcon(false, 20), handlers.onToggleMute)
      parca.sagir = yuvarlakDugme('Sağırlaştır', 'call-deafen', headphonesIcon(false, 20), handlers.onToggleDeafen)
      const kapat = yuvarlakDugme('Kapat', 'call-hangup', hangupIcon(20), handlers.onHangup)
      dugmeler.append(parca.sustur, parca.sagir, kapat)
      el.append(kisiler, sure, durum, dugmeler)
    }
    host.replaceChildren(el)
  }

  function basiliYap(b, basili, simge) {
    b.classList.toggle('active', !!basili)
    b.setAttribute('aria-pressed', String(!!basili))
    b.replaceChildren(simge)
  }

  function ciz(g) {
    if (!g) {
      faz = null
      el = null
      parca = {}
      host.replaceChildren()
      host.hidden = true
      return
    }
    host.hidden = false
    if (g.faz !== faz) { faz = g.faz; kur(g) }
    if (g.faz === 'araniyor') {
      if (parca.karsiAv?.dataset.id !== (g.other?.id ?? '')) {
        parca.karsiAv = aramaAvatari(g.other, { nabiz: true })
        parca.kisiler.replaceChildren(parca.karsiAv)
      }
      parca.ad.textContent = g.other?.username ?? ''
      parca.durum.textContent = ARAMA_METINLERI.araniyor
      return
    }
    const konusan = g.konusanlar ?? new Set()
    // Avatarlar aşama başında bir kez kurulur; sonra yalnız halka ve köşe simgesi güncellenir
    if (!parca.benAv) {
      parca.benAv = aramaAvatari(g.self)
      parca.karsiAv = aramaAvatari(g.other)
      parca.kisiler.replaceChildren(parca.benAv, parca.karsiAv)
    }
    avatariGuncelle(parca.benAv, { konusuyor: konusan.has(g.self?.id), durum: g.ben })
    avatariGuncelle(parca.karsiAv, { konusuyor: konusan.has(g.other?.id), durum: g.karsi })
    parca.sure.textContent = g.sure
    parca.durum.textContent = g.baglanti ?? ''
    parca.durum.hidden = !g.baglanti
    const ben = g.ben ?? {}
    // Sağırlaştırma susturmayı da getirir: mikrofon simgesi sağırken de çizili görünür
    basiliYap(parca.sustur, ben.muted, micIcon(ben.muted || ben.deafened, 20))
    basiliYap(parca.sagir, ben.deafened, headphonesIcon(ben.deafened, 20))
    // Mikrofon yoksa Sustur açılamaz
    if (ben.listenOnly) {
      parca.sustur.dataset.pasif = '1'
      parca.sustur.setAttribute('aria-disabled', 'true')
      parca.sustur.classList.add('unavailable')
    }
  }

  return { ciz }
}

// Akışın anlık bilgisinden panelin görünümü (self: giriş yapan kişinin profili)
export function aramaGorunumu(bilgi, self) {
  if (!bilgi) return null
  const other = bilgi.thread?.other ?? null
  if (bilgi.faz !== 'konusma') return { faz: 'araniyor', self, other }
  const st = bilgi.oturum.getState()
  return {
    faz: 'konusma',
    self,
    other,
    sure: sureYazisi(bilgi.sureMs),
    baglanti: bilgi.baglanti === 'koptu' ? ARAMA_METINLERI.koptu : bilgi.baglanti === 'baglaniyor' ? ARAMA_METINLERI.baglaniyor : null,
    konusanlar: st.speaking,
    ben: { muted: st.muted, deafened: st.deafened, listenOnly: st.listenOnly },
    karsi: other ? (bilgi.oturum.getPeerState?.(other.id) ?? null) : null,
  }
}

// ---- Akış ----
// deps:
//   startCall(threadId) -> { id, status }, endCall(id, reason), pingCall(id) -> boolean,
//   getCallStatus(id) -> { status, reason } | null (data/calls.js; kaçan olayı telafi eder)
//   enter(call, thread) -> ses oturumu | null (app.js aramayaGir; sesli kanaldan çıkış dahil)
//   exit(reason) -> Promise (app.js aramadanCik; reason null = yalnız yerel kapanış)
//   beforeStart(call) : arama başlarken (sesli kanaldaysak oradan çık + bildirim; açık gelen arama kartı reddedilir)
//   toast(metin, tur), beep(ad), startTone() -> durdur fonksiyonu (bekleme tonu)
//   onChange() : durum değişti (panel ve 📞 düğmesi yeniden çizilir)
// Aşamalar (faz): 'baslatiliyor' (startCall sürüyor) -> 'araniyor' -> 'konusma'.
export function createCallFlow(deps) {
  const { startCall, endCall, pingCall, getCallStatus, enter, exit, beforeStart, toast, beep, startTone, onChange } = deps
  let d = null // { faz, thread, call, oturum, baslangic, karsiBaglandi, bekleyenOlay }
  let zilZ = 0
  let kopukZ = 0
  let pingZ = 0
  let tikZ = 0
  let tonDurdur = null
  let oturumBirak = []
  // Zaman aşımıyla bırakılan aramalar: callId -> { call, thread, zaman }. Sunucu cevaplanmış aramayı
  // timeout ile bitirmez; "active" olayı sonradan gelirse (karşı taraf son anda kabul etti) konuşmaya girilir.
  // Kısa süre tutulur (BIRAKILAN_MS); sayaç kurulmaz, okurken süresi geçenler atılır.
  const birakilanlar = new Map()

  const degisti = () => onChange?.()
  const bitir = (id, neden) => { Promise.resolve(endCall(id, neden)).catch(() => { /* sunucudaki bayatlık kuralı bitirir */ }) }

  // Bütün sayaçlar, bekleme tonu ve oturum dinleyicileri durur (her çıkış yolunda)
  function temizle() {
    clearTimeout(zilZ)
    clearTimeout(kopukZ)
    clearInterval(pingZ)
    clearInterval(tikZ)
    zilZ = kopukZ = pingZ = tikZ = 0
    tonDurdur?.()
    tonDurdur = null
    for (const f of oturumBirak) f()
    oturumBirak = []
  }

  // "Aranıyor…" kapanır: bitiş biplemesi, varsa bildirim
  function aramaKapandi(metin, tur = 'bilgi') {
    temizle()
    d = null
    beep?.('leave')
    if (metin) toast?.(metin, tur)
    degisti()
  }

  // Konuşma biter: oturum kapanır (reason verilirse sunucuda da biter; biplemeyi oturum çalar)
  function konusmaBitti(reason, metin = null) {
    temizle()
    d = null
    exit(reason)
    if (metin) toast?.(metin, 'hata')
    degisti()
  }

  async function baslat(thread) {
    if (d || !thread?.id) return
    const benim = { faz: 'baslatiliyor', thread, call: null, bekleyenOlay: null }
    d = benim
    degisti()
    let call
    try {
      call = await startCall(thread.id)
    } catch (e) {
      if (d === benim) { d = null; degisti() }
      toast?.(aramaHataMetni(e, thread.other?.username ?? ''), ['BUSY', 'ALREADY_IN_CALL'].includes(e?.code) ? 'bilgi' : 'hata')
      return
    }
    if (d !== benim) {
      // Beklerken İptal'e basıldı ya da uygulama kapandı: açılan aramayı geri al. Ama bu arada aynı
      // aramaya bağlandıysak (ör. birleşmiş arama gelen kartından kabul edildi) o arama kapatılmaz.
      if (call?.id && d?.call?.id !== call.id) bitir(call.id, call.status === 'active' ? 'hangup' : 'cancel')
      return
    }
    if (!call?.id || !['ringing', 'active'].includes(call.status)) {
      d = null
      toast?.(ARAMA_METINLERI.baslatilamadi, 'hata')
      degisti()
      return
    }
    beforeStart?.(call) // sesli kanaldaysak önce oradan çıkılır
    // Karşı taraf da beni arıyordu: onun araması kabul edildi, doğrudan konuşmaya geç
    if (call.status === 'active') { baglan(call, thread); return }
    d = { faz: 'araniyor', thread, call }
    tonDurdur = startTone?.() ?? null
    zilZ = setTimeout(() => {
      zilZ = 0
      durumuDenetle(call.id, { zamanAsimi: true })
    }, callTiming.ringMs)
    degisti()
    // startCall sürerken bu arama için olay geldiyse (ör. hemen kabul edildi) şimdi uygula
    if (benim.bekleyenOlay?.callId === call.id) olay(benim.bekleyenOlay)
  }

  // "Aranıyor…" iken aramanın sunucudaki durumunu okur ("arama" olayı kaçmış olabilir):
  //   active -> konuşmaya geç; ended -> nedenine göre kapan; hâlâ ringing -> zamanAsimi ise timeout ile bitir.
  // Okunamazsa zaman aşımında yine timeout gönderilir (sunucu cevaplanmış aramayı timeout ile bitirmez).
  async function durumuDenetle(callId, { zamanAsimi = false } = {}) {
    const hala = () => d?.faz === 'araniyor' && d.call.id === callId
    if (!hala()) return
    let durum = null
    try { durum = (await getCallStatus?.(callId)) ?? null } catch { /* okunamadı */ }
    if (!hala()) return // beklerken olay geldi ya da iptal edildi
    if (durum?.status === 'active') { baglan(d.call, d.thread); return }
    if (durum?.status === 'ended') { olay({ callId, threadId: d.thread.id, status: 'ended', reason: durum.reason }); return }
    if (!zamanAsimi) return
    // Bu arada karşı taraf kabul etmiş olabilir (sunucu timeout'u yok sayar): "active" gelirse konuşmaya girilir
    birakilanlar.set(callId, { call: d.call, thread: d.thread, zaman: Date.now() })
    bitir(callId, 'timeout')
    aramaKapandi(ARAMA_METINLERI.cevapYok)
  }

  // Zaman aşımıyla bırakılan arama (süresi geçmediyse) -> { call, thread } | null
  function birakilan(callId) {
    for (const [id, b] of birakilanlar) if (Date.now() - b.zaman > BIRAKILAN_MS) birakilanlar.delete(id)
    return birakilanlar.get(callId) ?? null
  }

  // user: kanalı yeniden bağlandı: kaçan olay olabilir, durumu yeniden oku.
  //  "Aranıyor…" iken: durumuDenetle. Konuşmada: arama bu arada bittiyse normal bitiş
  //  (bitiş biplemesini oturum çalar; "bağlantı koptu" denmez).
  async function yenidenDenetle() {
    if (d?.faz === 'araniyor') { durumuDenetle(d.call.id); return }
    if (d?.faz !== 'konusma') return
    const callId = d.call.id
    let durum = null
    try { durum = (await getCallStatus?.(callId)) ?? null } catch { return } // okunamadı: canlılık kuralı bakar
    if (durum?.status === 'ended' && d?.faz === 'konusma' && d.call.id === callId) konusmaBitti(null)
  }

  // İptal: arama başlarken ya da "Aranıyor…" iken. Konuşmada bir şey yapmaz (orada Kapat var).
  function iptal() {
    if (!d || d.faz === 'konusma') return
    if (d.faz === 'baslatiliyor') { d = null; degisti(); return } // startCall dönünce geri alınır
    bitir(d.call.id, 'cancel')
    aramaKapandi(null)
  }

  // Kapat: konuşmada aramayı iki tarafta bitirir; "Aranıyor…" iken İptal ile aynı
  function kapat() {
    if (!d) return
    if (d.faz !== 'konusma') { iptal(); return }
    konusmaBitti('hangup')
  }

  // Konuşmaya geç: ses oturumu açılır (arayan: karşı taraf kabul edince; aranan: Kabul et'e basınca —
  // gelen arama kartı bu fonksiyonu çağırır). Konuşmada başka bir arama varsa onun sayaçları bırakılır.
  function baglan(call, thread) {
    if (!call?.id) return
    if (d?.faz === 'konusma' && d.call.id === call.id) return
    temizle()
    d = null
    const oturum = enter(call, thread)
    if (!oturum) { degisti(); return }
    d = { faz: 'konusma', thread, call, oturum, baslangic: Date.now(), karsiBaglandi: false, kopukTur: undefined }
    const kontrolEt = () => { if (d?.oturum === oturum) baglantiyiDenetle() }
    oturumBirak = [
      oturum.on('change', kontrolEt),
      oturum.on('tracks', kontrolEt),
      oturum.on('speaking', () => { if (d?.oturum === oturum) degisti() }),
    ]
    pingZ = setInterval(() => canliTut(call.id), callTiming.pingMs)
    tikZ = setInterval(() => { if (d?.oturum === oturum) degisti() }, callTiming.tickMs)
    baglantiyiDenetle()
  }

  // Karşıyla bağlantı: 'baglaniyor' (henüz hiç bağlanmadı) | 'koptu' (bağlıydı, düştü) | null (bağlı).
  function baglantiDurumu() {
    if (!d || d.faz !== 'konusma') return null
    const karsi = d.thread?.other?.id
    const st = d.oturum.getState()
    const bagli = st.status !== 'failed' && (d.oturum.connectedPeers?.() ?? []).includes(karsi)
    if (bagli) { d.karsiBaglandi = true; return null }
    return d.karsiBaglandi ? 'koptu' : 'baglaniyor'
  }

  // Bağlantı yoksa sayaç kurulur (koptuysa 15 sn, hiç bağlanmadıysa 30 sn); düzelince sayaç kalkar
  function baglantiyiDenetle() {
    const durum = baglantiDurumu()
    if (durum !== d.kopukTur) {
      // Durum değişti: eski sayaç bırakılır, gerekirse yenisi kurulur
      clearTimeout(kopukZ)
      kopukZ = 0
      d.kopukTur = durum
      if (durum) {
        const id = d.call.id
        kopukZ = setTimeout(() => {
          kopukZ = 0
          if (d?.call?.id === id && baglantiDurumu()) konusmaBitti('lost', ARAMA_METINLERI.baglantiKoptu)
        }, durum === 'koptu' ? callTiming.lostMs : callTiming.firstConnectMs)
      }
    }
    degisti()
  }

  // 20 sn'de bir: arama sürüyor mu? Sunucu "bitti/bayat" derse yerelde kapanır.
  async function canliTut(id) {
    let surdu
    try { surdu = await pingCall(id) } catch { return } // ağ hatası: kopma kuralı ayrıca bakar
    if (!surdu && d?.faz === 'konusma' && d.call.id === id) konusmaBitti(null, ARAMA_METINLERI.baglantiKoptu)
  }

  // user:<uid> "arama" olayı (parseCallEvent sonucu). 'ringing' (gelen arama) app.js'te ayrı işlenir.
  function olay(ev) {
    if (!ev) return
    // Zaman aşımıyla bıraktığımız arama: bittiyse unutulur; karşı taraf kabul ettiyse konuşmaya girilir
    // (yalnız o sırada başka bir arama akışında değilsek)
    const b = birakilan(ev.callId)
    if (b) {
      if (ev.status === 'ended') birakilanlar.delete(ev.callId)
      else if (ev.status === 'active' && !d) {
        birakilanlar.delete(ev.callId)
        baglan(b.call, b.thread)
        return
      }
    }
    if (!d) return
    if (d.faz === 'baslatiliyor') {
      // Arama kimliğini henüz bilmiyoruz: bu konuşmanın olayını sakla, startCall dönünce uygulanır
      if (ev.threadId === d.thread.id) d.bekleyenOlay = ev
      return
    }
    if (d.call?.id !== ev.callId) return
    if (d.faz === 'araniyor') {
      if (ev.status === 'active') { baglan(d.call, d.thread); return }
      if (ev.status === 'ended') {
        const ad = d.thread.other?.username ?? ''
        if (ev.reason === 'decline') aramaKapandi(reddettiMetni(ad))
        else if (ev.reason === 'timeout') aramaKapandi(ARAMA_METINLERI.cevapYok)
        else aramaKapandi(null)
      }
      return
    }
    // Konuşmada: karşı taraf kapattı (ya da arama başka yoldan bitti) -> yalnız yerel kapanış
    if (ev.status === 'ended') konusmaBitti(null, ev.reason === 'lost' ? ARAMA_METINLERI.baglantiKoptu : null)
  }

  // app.js aramadanCik çağırdı (sesli kanala girildi, başka arama, sayfa kapanıyor, katılma hatası):
  // bu aramanın sayaçları ve paneli kapanır; oturum zaten kapandı.
  function sesKapandi(callId) {
    if (d?.faz !== 'konusma' || d.call.id !== callId) return
    temizle()
    d = null
    degisti()
  }

  return {
    baslat,
    iptal,
    kapat,
    baglan,
    olay,
    sesKapandi,
    yenidenDenetle,
    // Anlık bilgi (panel ve 📞 düğmesi için): null | { faz, thread, call, oturum?, sureMs?, baglanti? }
    bilgi() {
      if (!d) return null
      if (d.faz !== 'konusma') return { faz: d.faz, thread: d.thread, call: d.call }
      return {
        faz: 'konusma',
        thread: d.thread,
        call: d.call,
        oturum: d.oturum,
        sureMs: Date.now() - d.baslangic,
        baglanti: baglantiDurumu(),
      }
    },
  }
}
