// Grup araması (v0.9.0): akış (başlat / katıl / ayrıl, 30 sn "Cevap yok", canlılık) ve grubun üstündeki panel
// (katılımcı ızgarası, konuşan halkası, susturma simgesi, süre, Sustur/Sağırlaştır/Kamera/Ekran/Ayrıl).
// Ses oturumunu app.js açar/kapatır (enter = aramayaGir, exit = aramadanCik). Sinyal konusu dm-voice:<arama id>,
// P2P mesh (sesli kanal gibi çok kişi). Sunucu kuralları: supabase/migrations/011_grup_dm.sql.
import { micIcon, headphonesIcon, hangupIcon, cameraIcon, screenIcon, phoneIcon } from './icons.js'
import { screenShareSupported, desktopScreenNotice } from '../voice/screenShare.js'
import { isTauri } from '../desktop.js'
import { aramaAvatari, avatariGuncelle, yuvarlakDugme, dugmeDurumu, sureYazisi, ARAMA_METINLERI } from './callPanel.js'
import { GRUP_HATALARI } from '../data/groups.js'

// Süreler (ms). Testler değiştirebilir.
export const groupCallTiming = {
  ringMs: 30000, // başlatan: kimse katılmazsa arama "Cevap yok" ile biter
  pingMs: 20000, // canlılık bildirimi
  tickMs: 1000, // süre sayacı
}

const BILINMEYEN = 'Bilinmeyen'

export const GRUP_ARAMA_METINLERI = {
  baslat: 'Grubu ara',
  aramadasin: 'Aramadasın',
  ayril: 'Ayrıl',
  bekleniyor: 'Aranıyor…',
  cevapYok: 'Cevap yok.',
  bitti: 'Arama sona erdi.',
  baslatilamadi: 'Arama başlatılamadı. Tekrar dene.',
  cikarildin: 'Gruptan çıkarıldın.',
}

// Hata -> metin (sunucu kodları GRUP_HATALARI'nda; bilinmeyen hata genel metin)
export function grupAramaHataMetni(e) {
  if (e?.code && GRUP_HATALARI[e.code]) return GRUP_HATALARI[e.code]
  return e?.message || GRUP_ARAMA_METINLERI.baslatilamadi
}

// ---- Akış ----
// deps:
//   selfId
//   startGroupCall(threadId) -> { id, status, caller }, joinGroupCall(callId) -> { id, status },
//   leaveGroupCall(callId, reason), pingGroupCall(callId) -> boolean (data/groups.js)
//   beforeJoin() -> Promise : başka arama/sesli kanal açıksa önce kapanır (sunucu ALREADY_IN_CALL demesin)
//   enter(call, thread) -> ses oturumu | null (app.js aramayaGir), exit(reason) -> Promise (app.js aramadanCik;
//     grup aramasında leaveGroupCall'ı o çağırır; reason null = yalnız yerel kapanış)
//   toast(metin, tur), beep(ad), startTone() -> durdur, onChange()
// Aşamalar (faz): 'baglaniyor' (RPC sürüyor) -> 'aramada'.
export function createGroupCallFlow(deps) {
  const { selfId, startGroupCall, joinGroupCall, leaveGroupCall, pingGroupCall, beforeJoin, enter, exit, toast, beep, startTone, onChange } = deps
  let d = null // { faz, thread, call, oturum, baslangic, bekliyor, sayi }
  let zilZ = 0
  let pingZ = 0
  let tikZ = 0
  let tonDurdur = null
  let oturumBirak = []

  const degisti = () => onChange?.()

  function temizle() {
    clearTimeout(zilZ)
    clearInterval(pingZ)
    clearInterval(tikZ)
    zilZ = pingZ = tikZ = 0
    tonDurdur?.()
    tonDurdur = null
    for (const f of oturumBirak) f()
    oturumBirak = []
  }

  // Arama biter (bizim için): oturum kapanır; reason verilirse sunucuda da ayrılınır (exit -> leaveGroupCall)
  function bitti(reason, metin = null, tur = 'bilgi') {
    temizle()
    d = null
    exit(reason)
    if (metin) toast?.(metin, tur)
    degisti()
  }

  // Ortak giriş: RPC (başlat ya da katıl) -> sese gir
  async function gir(thread, rpc) {
    if (d || !thread?.id) return
    const benim = { faz: 'baglaniyor', thread, call: null }
    d = benim
    degisti()
    let call
    try {
      await beforeJoin?.()
      call = await rpc()
    } catch (e) {
      if (d === benim) { d = null; degisti() }
      toast?.(grupAramaHataMetni(e), e?.code === 'ALREADY_IN_CALL' ? 'bilgi' : 'hata')
      return
    }
    if (d !== benim) {
      // Beklerken vazgeçildi ya da uygulama kapandı: girdiğimiz aramadan çık
      if (call?.id && call.status !== 'ended') Promise.resolve(leaveGroupCall(call.id, 'hangup')).catch(() => {})
      return
    }
    if (!call?.id || call.status === 'ended') {
      d = null
      toast?.(GRUP_ARAMA_METINLERI.bitti)
      degisti()
      return
    }
    baglan(call, thread)
  }

  // 📞: grubu arar (süren arama varsa ona katılır)
  function baslat(thread) {
    return gir(thread, () => startGroupCall(thread.id))
  }

  // "Aramaya katıl" (ya da gelen kartın Kabul et'i sonrası değil: kart joinGroupCall'ı kendisi çağırır, sonra baglan)
  function katil(thread, callId) {
    return gir(thread, () => joinGroupCall(callId))
  }

  // Sese gir. Başlatan ve henüz kimse katılmadıysa "Aranıyor…" + 30 sn sayaç.
  function baglan(call, thread) {
    if (!call?.id) return
    if (d?.faz === 'aramada' && d.call.id === call.id) return
    temizle()
    d = null
    const oturum = enter({ ...call, isGroup: true }, thread)
    if (!oturum) { degisti(); return }
    const bekliyor = call.status === 'ringing' && call.caller === selfId
    d = { faz: 'aramada', thread, call: { ...call, isGroup: true }, oturum, baslangic: Date.now(), bekliyor, sayi: null }
    oturumBirak = [
      oturum.on('change', () => { if (d?.oturum === oturum) degisti() }),
      oturum.on('speaking', () => { if (d?.oturum === oturum) degisti() }),
      oturum.on('tracks', () => { if (d?.oturum === oturum) degisti() }),
    ]
    if (bekliyor) {
      tonDurdur = startTone?.() ?? null
      zilZ = setTimeout(() => {
        zilZ = 0
        if (d?.call?.id !== call.id || !d.bekliyor) return
        Promise.resolve(leaveGroupCall(call.id, 'timeout')).catch(() => {})
        bitti(null, GRUP_ARAMA_METINLERI.cevapYok)
      }, groupCallTiming.ringMs)
    }
    pingZ = setInterval(() => canliTut(call.id), groupCallTiming.pingMs)
    tikZ = setInterval(() => { if (d?.oturum === oturum) degisti() }, groupCallTiming.tickMs)
    degisti()
  }

  async function canliTut(id) {
    let surdu
    try { surdu = await pingGroupCall(id) } catch { return } // ağ hatası: bir sonraki denemede bakılır
    if (!surdu && d?.call?.id === id) bitti(null, ARAMA_METINLERI.baglantiKoptu, 'hata')
  }

  // Bekleme bitti (biri katıldı): ton ve 30 sn sayacı durur
  function beklemeBitti() {
    if (!d?.bekliyor) return
    d.bekliyor = false
    clearTimeout(zilZ)
    zilZ = 0
    tonDurdur?.()
    tonDurdur = null
    beep?.('join')
  }

  // "grup_arama" olayı (parseGroupCallEvent sonucu) — yalnız içinde olduğumuz arama
  function olay(ev) {
    if (!ev || d?.faz !== 'aramada' || d.call.id !== ev.callId) return
    if (ev.status === 'ended') { bitti(null); return }
    d.sayi = ev.count
    if (ev.status === 'active' || ev.count > 1) beklemeBitti()
    degisti()
  }

  // Ayrıl: başlatan ve kimse katılmadıysa arama iptal olur ('cancel'); değilse yalnız biz çıkarız
  function kapat() {
    if (!d) return
    if (d.faz !== 'aramada') { d = null; degisti(); return } // RPC dönünce geri alınır
    bitti(d.bekliyor ? 'cancel' : 'hangup')
  }

  // app.js aramadanCik çağırdı (sesli kanala girildi, başka arama, sayfa kapanıyor): sayaçlar ve panel kapanır
  function sesKapandi(callId) {
    if (d?.faz !== 'aramada' || d.call.id !== callId) return
    temizle()
    d = null
    degisti()
  }

  return {
    baslat,
    katil,
    baglan,
    olay,
    kapat,
    sesKapandi,
    // null | { faz, thread, call, oturum?, sureMs?, bekliyor?, sayi? }
    bilgi() {
      if (!d) return null
      if (d.faz !== 'aramada') return { faz: d.faz, thread: d.thread, call: d.call }
      return { faz: 'aramada', thread: d.thread, call: d.call, oturum: d.oturum, sureMs: Date.now() - d.baslangic, bekliyor: d.bekliyor, sayi: d.sayi }
    },
  }
}

// Akışın bilgisinden panelin görünümü. self: giriş yapan kişi; members: grubun üyeleri.
// Katılımcılar: biz + ses oturumunda bağlı olduğumuz kişiler (gruptaki profilleriyle).
export function grupAramaGorunumu(bilgi, self, members = []) {
  if (!bilgi || bilgi.faz !== 'aramada') return null
  const st = bilgi.oturum.getState()
  const bagli = new Set(bilgi.oturum.connectedPeers?.() ?? [])
  const konusanlar = st.speaking ?? new Set()
  const kisiler = [{ kisi: self, konusuyor: konusanlar.has(self?.id), durum: { muted: st.muted, deafened: st.deafened } }]
  for (const u of members) {
    if (u.id === self?.id || !bagli.has(u.id)) continue
    kisiler.push({ kisi: u, konusuyor: konusanlar.has(u.id), durum: bilgi.oturum.getPeerState?.(u.id) ?? null })
  }
  // Bağlı ama grup listesinde olmayan eş (ör. az önce çıkarıldı, bağlantısı kapanıyor): gizlenmez, "Bilinmeyen"
  const uyeIdleri = new Set(members.map((u) => u.id))
  for (const id of bagli) {
    if (id === self?.id || uyeIdleri.has(id)) continue
    kisiler.push({ kisi: { id, username: BILINMEYEN, color: null, avatar_url: null }, konusuyor: konusanlar.has(id), durum: bilgi.oturum.getPeerState?.(id) ?? null })
  }
  return {
    katilimcilar: kisiler,
    sure: sureYazisi(bilgi.sureMs),
    bekliyor: !!bilgi.bekliyor,
    ben: { muted: st.muted, deafened: st.deafened, listenOnly: st.listenOnly, camera: !!st.camera, screen: !!st.screen, status: st.status },
    hata: st.cameraError ?? st.screenError ?? null,
  }
}

function basiliYap(b, basili, simge) {
  b.classList.toggle('active', !!basili)
  b.setAttribute('aria-pressed', String(!!basili))
  b.replaceChildren(simge)
}

// host: panelin kutusu (grup açıkken başlığın altı). handlers: onLeave, onToggleMute, onToggleDeafen,
// onToggleCamera, onToggleScreen. ciz(g): null -> gizli. Düğmeler bir kez kurulur (odak kaybolmasın);
// ızgara yalnız katılımcılar değişince yeniden kurulur, halka ve simgeler yerinde güncellenir.
export function mountGroupCallPanel(host, handlers = {}) {
  let el = null
  let parca = {}
  let izgaraAnahtari = ''
  host.hidden = true

  function kur() {
    el = document.createElement('section')
    el.className = 'call-panel konusma group-call-panel'
    el.setAttribute('aria-label', 'Grup araması')
    const izgara = document.createElement('div')
    izgara.className = 'group-call-grid'
    izgara.setAttribute('role', 'list')
    izgara.setAttribute('aria-label', 'Aramadakiler')
    const sure = document.createElement('div')
    sure.className = 'call-timer'
    const durum = document.createElement('div')
    durum.className = 'call-status'
    durum.setAttribute('aria-live', 'polite')
    const dugmeler = document.createElement('div')
    dugmeler.className = 'call-buttons'
    parca = { izgara, sure, durum, avatarlar: new Map() }
    parca.sustur = yuvarlakDugme('Sustur', 'call-mute', micIcon(false, 20), handlers.onToggleMute)
    parca.sagir = yuvarlakDugme('Sağırlaştır', 'call-deafen', headphonesIcon(false, 20), handlers.onToggleDeafen)
    parca.kamera = yuvarlakDugme('Kamera', 'call-video call-camera', cameraIcon(false, 20), handlers.onToggleCamera)
    dugmeler.append(parca.sustur, parca.sagir, parca.kamera)
    if (screenShareSupported()) {
      parca.ekran = yuvarlakDugme('Ekran', 'call-video call-screen', screenIcon(20), handlers.onToggleScreen)
      dugmeler.append(parca.ekran)
    } else if (isTauri()) {
      const b = yuvarlakDugme('Ekran', 'call-video call-screen', screenIcon(20), null)
      dugmeDurumu(b, { ad: 'Ekranı paylaş', pasif: true, neden: desktopScreenNotice() })
      dugmeler.append(b)
    }
    parca.ayril = yuvarlakDugme(GRUP_ARAMA_METINLERI.ayril, 'call-hangup', hangupIcon(20), handlers.onLeave)
    dugmeler.append(parca.ayril)
    el.append(izgara, sure, durum, dugmeler)
    host.replaceChildren(el)
    izgaraAnahtari = ''
  }

  function ciz(g) {
    if (!g) {
      el = null
      parca = {}
      izgaraAnahtari = ''
      host.replaceChildren()
      host.hidden = true
      return
    }
    host.hidden = false
    if (!el) kur()
    // Izgara: katılımcı kümesi değişince yeniden kurulur
    const anahtar = g.katilimcilar.map((k) => k.kisi?.id).join(',')
    if (anahtar !== izgaraAnahtari) {
      izgaraAnahtari = anahtar
      parca.avatarlar = new Map()
      const ogeler = g.katilimcilar.map((k) => {
        const kutu = document.createElement('div')
        kutu.className = 'group-call-person'
        kutu.setAttribute('role', 'listitem')
        const av = aramaAvatari(k.kisi, { konusuyor: k.konusuyor, durum: k.durum, nabiz: g.bekliyor && k.kisi?.id === g.katilimcilar[0]?.kisi?.id })
        const ad = document.createElement('span')
        ad.className = 'group-call-name'
        ad.textContent = k.kisi?.username ?? ''
        kutu.append(av, ad)
        parca.avatarlar.set(k.kisi?.id, av)
        return kutu
      })
      parca.izgara.replaceChildren(...ogeler)
    }
    for (const k of g.katilimcilar) {
      const av = parca.avatarlar.get(k.kisi?.id)
      if (av) {
        avatariGuncelle(av, { konusuyor: k.konusuyor, durum: k.durum })
        av.classList.toggle('nabiz', g.bekliyor && k === g.katilimcilar[0])
      }
    }
    parca.sure.textContent = g.sure
    const durumYazisi = g.bekliyor ? GRUP_ARAMA_METINLERI.bekleniyor : (g.hata ?? null)
    parca.durum.textContent = durumYazisi ?? ''
    parca.durum.hidden = !durumYazisi
    const ben = g.ben ?? {}
    const baglaniyor = ben.status === 'connecting'
    basiliYap(parca.kamera, ben.camera, cameraIcon(false, 20))
    dugmeDurumu(parca.kamera, { ad: ben.camera ? 'Kamerayı kapat' : 'Kamerayı aç', pasif: baglaniyor, neden: ARAMA_METINLERI.baglanirkenOlmaz })
    if (parca.ekran) {
      basiliYap(parca.ekran, ben.screen, screenIcon(20))
      dugmeDurumu(parca.ekran, { ad: ben.screen ? 'Paylaşımı durdur' : 'Ekranı paylaş', pasif: baglaniyor, neden: ARAMA_METINLERI.baglanirkenOlmaz })
    }
    basiliYap(parca.sustur, ben.muted, micIcon(ben.muted || ben.deafened, 20))
    basiliYap(parca.sagir, ben.deafened, headphonesIcon(ben.deafened, 20))
    if (ben.listenOnly) {
      parca.sustur.dataset.pasif = '1'
      parca.sustur.setAttribute('aria-disabled', 'true')
      parca.sustur.classList.add('unavailable')
    }
  }

  return { ciz }
}

// Grup başlığındaki arama düğmesi: 📞 "Grubu ara" | "Aramaya katıl (N)" | "Aramadasın" (pasif) |
// başka aramadaysan "Zaten bir aramadasın." (pasif). update({ call, inThisCall, inOtherCall })
export function createGroupCallButton({ onStart, onJoin }) {
  const b = document.createElement('button')
  b.type = 'button'
  b.className = 'icon-btn call-start group-call-start'
  b.dataset.tipSide = 'bottom'
  const yazi = document.createElement('span')
  yazi.className = 'group-call-join-text'
  let durum = { call: null }
  b.onclick = () => {
    if (b.dataset.pasif) return
    if (durum.call) onJoin?.(durum.call)
    else onStart?.()
  }
  function update({ call = null, inThisCall = false, inOtherCall = false } = {}) {
    durum = { call }
    b.replaceChildren()
    const ad = inThisCall
      ? GRUP_ARAMA_METINLERI.aramadasin
      : call ? (call.count > 0 ? `Aramaya katıl (${call.count})` : 'Aramaya katıl') : GRUP_ARAMA_METINLERI.baslat
    const ipucu = !inThisCall && inOtherCall ? ARAMA_METINLERI.zatenAramada : ad
    const pasif = inThisCall || inOtherCall
    b.append(phoneIcon(20))
    if (call && !inThisCall) {
      yazi.textContent = ad
      b.append(yazi)
      b.classList.add('join')
    } else b.classList.remove('join')
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
