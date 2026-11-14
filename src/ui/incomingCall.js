// DM sesli araması (aranan taraf): sağ altta "Ad seni arıyor" kartı, Kabul et / Reddet ve zil.
// Kurallar: docs/superpowers/specs/2026-11-13-voxen-dm-arama-design.md §2.
//   - Kart bildirimlerin (toast) üstünde durur, odak almaz; role="alertdialog" ile bir kez okunur, Tab ile düğmelere gelinir.
//   - 30 sn sonra kart kendiliğinden kapanır (zaman aşımını arayan gönderir; burada yalnız yerel kapanış).
//   - Reddet -> endCall(id, 'decline'). Kabul et -> answerCall(id), sonra onAccept (app.js konuşmaya geçer).
//   - Zil çalsın mı, masaüstü bildirimi gelsin mi kararını app.js verir (zilCalsinMi, notify.js shouldNotifyCall).
import { phoneIcon, hangupIcon } from './icons.js'
import { avatarTextColor } from './avatarColor.js'

// Süreler (ms). Testler değiştirebilir.
export const incomingTiming = { ringMs: 30000 }

export const GELEN_ARAMA_METINLERI = {
  kabul: 'Kabul et',
  reddet: 'Reddet',
  bitti: 'Arama sona erdi.',
  bilinmeyen: 'Biri', // arayanın adı alınamadıysa: "Biri seni arıyor"
}
export const seniAriyorMetni = (ad) => `${ad} seni arıyor`

// Zil çalsın mı: "Rahatsız etmeyin"de ve "Bildirim sesi" kapalıyken çalmaz (kart yine görünür)
export function zilCalsinMi({ durum, ayarlar }) {
  return durum !== 'dnd' && ayarlar?.ses !== false
}

// deps:
//   host() -> kartın konacağı kutu (bildirim kutusu; kart en üste konur)
//   answerCall(id) -> { id, status } (data/calls.js), endCall(id, reason)
//   onAccept(call, thread): kabul edildi, arama aktif (app.js: konuşmaya geç, DM'i aç)
//   toast(metin, tur), startRing() -> durdur fonksiyonu (zil döngüsü)
//   onChange() : kabul sürüyor durumu değişti (app.js 📞 düğmesini yeniden çizer)
// Dönen: { goster({ callId, thread, zil }), kapat(callId), reddet(), bildirimEkle(callId, kapat), acik() -> callId | null,
//          kabulEdiliyor() -> { callId, thread } | null (answerCall sürerken: meşgul sayılır), destroy() }
export function createIncomingCall(deps) {
  const { host, answerCall, endCall, onAccept, toast, startRing, onChange } = deps
  let kart = null // { callId, thread, el, zamanlayici, zilDurdur, bildirimKapat }
  let kapandi = false
  let kabulde = null // { callId, thread }: Kabul et'e basıldı, answerCall sürüyor
  let siradaki = 0

  // Kart kapanır: zil durur, sayaç temizlenir, kart belgeden çıkar
  function kapatYerel() {
    if (!kart) return null
    const k = kart
    kart = null
    clearTimeout(k.zamanlayici)
    k.zilDurdur?.()
    try { k.bildirimKapat?.() } catch { /* bildirim zaten kapandı */ }
    k.el.remove()
    return k
  }

  async function kabul() {
    const k = kapatYerel()
    if (!k) return
    const bu = { callId: k.callId, thread: k.thread }
    kabulde = bu // kart kapandı ama arama henüz bizim değil: bu arada meşgul sayılırız
    onChange?.()
    let sonuc = null
    try { sonuc = await (k.answer ?? answerCall)(k.callId) } catch { /* arama bu arada bitti */ }
    if (kabulde === bu) kabulde = null
    if (kapandi) {
      // Kabul sürerken uygulama kapandı ama arama açıldı: karşı taraf boşuna beklemesin
      if (sonuc?.status === 'active') Promise.resolve((k.leave ?? endCall)(k.callId, 'hangup')).catch(() => { /* bayatlık kuralı bitirir */ })
      return
    }
    if (sonuc?.status !== 'active') { toast?.(GELEN_ARAMA_METINLERI.bitti); onChange?.(); return }
    ;(k.onAccept ?? onAccept)?.({ id: k.callId, status: 'active', ...(k.isGroup ? { isGroup: true } : {}) }, k.thread)
  }

  function reddet() {
    const k = kapatYerel()
    if (!k) return
    if (k.isGroup) return // grup araması: reddetmek yalnız kartı kapatır (arama diğerleri için sürer)
    Promise.resolve(endCall(k.callId, 'decline')).catch(() => { /* arayanın zaman aşımı ya da bayatlık kuralı bitirir */ })
  }

  // Gelen aramayı gösterir. Zaten bir kart açıksa (başka arama) gösterilmez: false döner.
  // Grup araması (group verilirse): { title: "Grup adı · berk arıyor", person: rozet kişisi, answer(id), leave(id, reason),
  //   onAccept(call, thread) }. Kabul answer ile (joinGroupCall), Reddet sunucuya bir şey göndermez.
  function goster({ callId, thread, zil = true, group = null }) {
    if (kapandi || !callId) return false
    if (kart) return kart.callId === callId
    const ad = thread?.other?.username || GELEN_ARAMA_METINLERI.bilinmeyen
    const el = kartiKur(group ? (group.person?.username || GELEN_ARAMA_METINLERI.bilinmeyen) : ad,
      group ? group.person : thread?.other, ++siradaki, group?.title ?? null)
    el.querySelector('.incoming-accept').onclick = () => kabul()
    el.querySelector('.incoming-decline').onclick = () => reddet()
    host().prepend(el) // bildirimlerin üstünde
    kart = {
      callId,
      thread,
      el,
      zilDurdur: zil ? (startRing?.() ?? null) : null,
      zamanlayici: setTimeout(() => kapatYerel(), incomingTiming.ringMs),
      isGroup: !!group,
      answer: group?.answer ?? null,
      leave: group?.leave ?? null,
      onAccept: group?.onAccept ?? null,
    }
    return true
  }

  return {
    goster,
    // Arama bitti ya da başka yerde cevaplandı (user: "arama" olayı): o aramanın kartı kapanır
    kapat(callId) {
      if (kart && (callId == null || kart.callId === callId)) kapatYerel()
    },
    // Açık kartı reddeder (giden arama başladı ya da sesli kanala girildi: aynı anda tek ses)
    reddet,
    // Kartın masaüstü bildirimi: kart kapanınca bildirim de kapanır (tarayıcıda Web Notification)
    bildirimEkle(callId, kapat) {
      if (kart?.callId === callId) kart.bildirimKapat = kapat
      else try { kapat?.() } catch { /* kart zaten kapandı */ }
    },
    acik: () => kart?.callId ?? null,
    kabulEdiliyor: () => kabulde,
    destroy() {
      kapandi = true
      kabulde = null
      kapatYerel()
    },
  }
}

// Kart: avatar, "Ad seni arıyor", Kabul et (yeşil) ve Reddet (kırmızı). Odak almaz.
// Sesli okuma: kart, aria-live="polite" bildirim kutusuna eklendiği için kutu onu bir kez okur ("ali seni arıyor,
// Kabul et, Reddet"). role="alertdialog" kartın ne olduğunu söyler; kart odak almadığı için ekran okuyucu onu
// diyalog olarak ayrıca açıp okumaz. Kartta ayrıca aria-live yok (ikinci duyuru olmasın).
function kartiKur(ad, kisi, no, baslikYazisi = null) {
  const el = document.createElement('div')
  el.className = 'incoming-call'
  el.setAttribute('role', 'alertdialog')
  const baslikId = `incoming-call-baslik-${no}`
  el.setAttribute('aria-labelledby', baslikId)

  const av = kisi?.avatar_url ? document.createElement('img') : document.createElement('span')
  av.className = 'incoming-call-avatar'
  if (kisi?.avatar_url) {
    av.src = kisi.avatar_url
    av.alt = ''
  } else {
    av.textContent = (Array.from(ad)[0] ?? '?').toLocaleUpperCase('tr')
    av.setAttribute('aria-hidden', 'true')
  }
  av.style.background = kisi?.color ?? null
  av.style.color = avatarTextColor(kisi?.color)

  const baslik = document.createElement('div')
  baslik.className = 'incoming-call-title'
  baslik.id = baslikId
  baslik.textContent = baslikYazisi ?? seniAriyorMetni(ad)

  const dugmeler = document.createElement('div')
  dugmeler.className = 'incoming-call-buttons'
  dugmeler.append(
    dugme('incoming-accept', GELEN_ARAMA_METINLERI.kabul, phoneIcon(16)),
    dugme('incoming-decline', GELEN_ARAMA_METINLERI.reddet, hangupIcon(16)),
  )
  el.append(av, baslik, dugmeler)
  return el
}

function dugme(sinif, yazi, simge) {
  const b = document.createElement('button')
  b.type = 'button'
  b.className = 'incoming-btn ' + sinif
  simge.setAttribute('aria-hidden', 'true')
  const s = document.createElement('span')
  s.textContent = yazi
  b.append(simge, s)
  return b
}
