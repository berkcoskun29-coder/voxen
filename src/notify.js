// Masaüstü bildirimleri (DM ve @bahsetme): karar, birleştirme, gösterme ve cihazdaki ayarlar.
// Kararı saf bir fonksiyon verir (shouldNotify); gösterimi masaüstünde Tauri bildirim eklentisi
// (src/desktop.js), tarayıcıda Web Notification yapar. Ses: src/voice/sounds.js ('bildirim' tonu).
import { isTauri, showDesktopNotification, onDesktopNotificationClick, focusWindow } from './desktop.js'
import { playBeep } from './voice/sounds.js'

export const notifyTiming = { birlesmeMs: 5000 } // aynı konuşmadan bu süre içinde gelenler birleşir
export const METIN_MAX = 100 // bildirim metni: mesajın ilk 100 karakteri
const SIMGE = '/favicon.svg' // tarayıcı bildiriminin simgesi: Voxen logosu (masaüstünde programın simgesi)

// ---------- Cihazdaki ayarlar (Ayarlar > Bildirimler) ----------
// İkisi de varsayılan olarak açık. Depolama kapalıysa (gizli pencere vb.) bu oturum boyunca bellekte kalır.
const AYAR_ANAHTARI = 'voxen.bildirimler'
export const NOTIFY_DEFAULTS = { masaustu: true, ses: true }
let bellek = null

export function getNotifySettings() {
  let ham
  try { ham = JSON.parse(localStorage.getItem(AYAR_ANAHTARI)) } catch { ham = bellek } // depolama kapalı: bellekteki
  return {
    masaustu: ham?.masaustu !== false,
    ses: ham?.ses !== false,
  }
}

// Sadece verilen alanları değiştirir: setNotifySettings({ ses: false })
export function setNotifySettings(degisiklik) {
  const yeni = { ...getNotifySettings(), ...degisiklik }
  bellek = yeni
  try { localStorage.setItem(AYAR_ANAHTARI, JSON.stringify(yeni)) } catch { /* bellekte kalır */ }
  return yeni
}

// ---------- Karar ----------
// Bildirim gelsin mi? Saf fonksiyon (spec §4, Review Focus 3):
//  msg: gelen mesaj satırı. DM'de thread_id, bahsetmede channel_id ve server_id (çağıran ekler) dolu.
//  selfId: kendi id'm. odakta: Voxen penceresi odakta mı. acikHedef: şu an açık konuşmanın id'si
//  (kanal id'si ya da DM konuşma id'si; yoksa null). durum: kendi durumum ('dnd' = Rahatsız etmeyin).
//  sessizSunucular: Set<serverId>. ayarlar: { masaustu }. tur: 'dm' | 'mention'
//  (bahsetmede mesajın beni andığını çağıran denetler: src/mentions.js mentionsUser).
// Gelmez: kendi mesajımsa, silinmişse, pencere odakta VE o konuşma açıksa, durum "Rahatsız etmeyin"se,
// sunucu sessizdeyse (yalnız bahsetmelerde; DM'ler sessize alınamaz), ayar kapalıysa.
export function shouldNotify({ msg, selfId, odakta, acikHedef, durum, sessizSunucular, ayarlar, tur }) {
  if (!msg || msg.deleted_at) return false
  if (msg.author_id === selfId) return false
  if (ayarlar && ayarlar.masaustu === false) return false
  if (durum === 'dnd') return false
  const hedef = hedefId(msg, tur)
  if (!hedef) return false
  if (odakta && acikHedef === hedef) return false
  if (tur === 'mention' && sessizSunucular?.has?.(msg.server_id)) return false
  return true
}

function hedefId(msg, tur) {
  if (tur === 'dm') return msg.thread_id ?? null
  if (tur === 'mention') return msg.channel_id ?? null
  return null
}

// ---------- Metinler ----------
// Başlık: DM için "Ad", bahsetme için "Ad (#kanal, Sunucu)"
export function bildirimBasligi({ tur, ad, kanal, sunucu }) {
  return tur === 'mention' ? `${ad} (#${kanal}, ${sunucu})` : ad
}

// Metin: mesajın ilk 100 karakteri (Türkçe/emoji karakterleri bölünmesin diye Array.from)
export function bildirimMetni(icerik) {
  return Array.from(String(icerik ?? '')).slice(0, METIN_MAX).join('')
}

// Birleşmiş bildirimin metni: "Ad: 3 yeni mesaj"
export function birlesikMetin(ad, sayi) {
  return `${ad}: ${sayi} yeni mesaj`
}

// ---------- Gösterim ve birleştirme ----------
// ac(hedef): bildirime tıklanınca hedefi açar; hedef { type: 'dm' | 'mention', id, serverId? }.
// deps (yalnız testler için): { goster(bildirim) -> gösterildi mi, sesCal(), odakla() }.
// Dönen: { bildir({ hedef, ad, baslik, metin }), tikla(hedef), destroy() }
//
// Birleştirme: bir konuşmanın ilk mesajı hemen gösterilir (ses de o an çalar). Sonraki 5 saniye içinde
// aynı konuşmadan gelenler sayılır; süre bitince fazladan mesaj geldiyse tek bir özet bildirim
// ("Ad: 3 yeni mesaj") gösterilir. Tarayıcıda özet aynı etiketle (tag) ilk bildirimin yerine geçer.
export function createNotifier({ ac, deps = {} } = {}) {
  const goster = deps.goster ?? varsayilanGoster
  const sesCal = deps.sesCal ?? (() => playBeep('bildirim'))
  const odakla = deps.odakla ?? focusWindow
  const pencereler = new Map() // hedef anahtarı -> { sayi, ad, baslik, hedef, zamanlayici }
  let kapandi = false
  let siradakiId = 1

  function tikla(hedef) {
    if (kapandi || !hedef) return
    odakla()
    ac?.(hedef)
  }

  // Masaüstünde tıklama eklentiden gelir (bildirimin verisinde hedef taşınır)
  let dinlemeyiBirak = () => {}
  if (!deps.goster && isTauri()) {
    onDesktopNotificationClick((hedef) => tikla(hedef)).then((birak) => {
      if (kapandi) birak()
      else dinlemeyiBirak = birak
    })
  }

  function yeniId() {
    siradakiId = siradakiId >= 2147483647 ? 1 : siradakiId + 1 // 32 bit tam sayı olmalı
    return siradakiId
  }

  function bildir({ hedef, ad, baslik, metin }) {
    if (kapandi || !hedef?.id) return
    const anahtar = `${hedef.type}:${hedef.id}`
    const acik = pencereler.get(anahtar)
    if (acik) { acik.sayi++; return } // süre içinde: sayılır, süre bitince özet gider
    const pencere = { sayi: 1, ad, baslik, hedef, zamanlayici: null }
    pencere.zamanlayici = setTimeout(() => {
      pencereler.delete(anahtar)
      if (kapandi || pencere.sayi < 2) return
      goster({ id: yeniId(), baslik: pencere.baslik, metin: birlesikMetin(pencere.ad, pencere.sayi), hedef, etiket: anahtar, tikla })
    }, notifyTiming.birlesmeMs)
    pencereler.set(anahtar, pencere)
    const gosterildi = goster({ id: yeniId(), baslik, metin, hedef, etiket: anahtar, tikla })
    // Ses yalnız bildirim gerçekten gösterildiyse (ör. tarayıcıda izin yoksa ses de yok)
    if (gosterildi && getNotifySettings().ses) sesCal()
  }

  return {
    bildir,
    tikla,
    destroy() {
      kapandi = true
      for (const p of pencereler.values()) clearTimeout(p.zamanlayici)
      pencereler.clear()
      dinlemeyiBirak()
    },
  }
}

// Masaüstünde Tauri eklentisi, tarayıcıda Web Notification. İzin yoksa sessizce gösterilmez.
// Dönen: gösterildi mi (true/false). Masaüstünde izin sorulmaz, gösterilmiş sayılır.
function varsayilanGoster({ id, baslik, metin, hedef, etiket, tikla }) {
  if (isTauri()) {
    showDesktopNotification({ id, title: baslik, body: metin, extra: { hedef } })
    return true
  }
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return false
  try {
    const n = new Notification(baslik, { body: metin, icon: SIMGE, tag: etiket })
    n.onclick = () => { n.close(); tikla(hedef) }
    return true
  } catch { return false } // bazı tarayıcılar sayfadan bildirime izin vermez: sessizce geç
}

// Tarayıcıda bildirim izni bir kez istenir (ilk DM açılınca ya da Ayarlar'dan). Masaüstünde gerekmez.
// Reddedilirse bir şey söylenmez: bildirimler sessizce kapalı kalır.
// DM açılınca istek oturum başına en fazla bir kez yapılır (kişi soruyu kapatıp geçtiyse her DM'de
// yeniden sorulmasın). acik: true (Ayarlar'dan) bu sınırı yok sayar.
let izinSoruldu = false
export async function requestNotifyPermission({ acik = false } = {}) {
  if (isTauri() || typeof Notification === 'undefined') return
  if (Notification.permission !== 'default' || !getNotifySettings().masaustu) return
  if (izinSoruldu && !acik) return
  izinSoruldu = true
  try { await Notification.requestPermission() } catch { /* sessizce geç */ }
}
