// Masaüstü bildirimleri (DM ve @bahsetme): karar, birleştirme, gösterme ve cihazdaki ayarlar.
// Kararı saf bir fonksiyon verir (shouldNotify); gösterimi masaüstünde Tauri bildirim eklentisi
// (src/desktop.js), tarayıcıda Web Notification yapar. Ses: src/voice/sounds.js ('bildirim' tonu).
import { isTauri, showDesktopNotification, onDesktopNotificationClick, focusWindow } from './desktop.js'
import { playBeep } from './voice/sounds.js'

// aynı konuşmadan bu süre içinde gelenler birleşir. Kanal mesajlarında ("Tüm mesajlar", tür 'channel') pencere
// kayar: her yeni mesaj süreyi uzatır (en fazla kayanEnFazlaMs), ses pencere başına bir kez (v0.13.0 tur 1, K1).
export const notifyTiming = { birlesmeMs: 5000, kayanEnFazlaMs: 30000 }
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

// ---------- Tepsi ayarları (masaüstü, cihazda; v0.13.0) ----------
// tepsiyeKucult: pencereyi kapatmak tepsiye küçültür (varsayılan açık; kapalıysa programdan çıkar).
// tepsiBilgisi: "Voxen arka planda çalışıyor." bilgisi bir kez gösterildi mi.
const TEPSI_ANAHTARI = 'voxen.tepsi'
let tepsiBellek = null
export function getTraySettings() {
  let ham
  try { ham = JSON.parse(localStorage.getItem(TEPSI_ANAHTARI)) } catch { ham = tepsiBellek }
  return { tepsiyeKucult: ham?.tepsiyeKucult !== false, tepsiBilgisi: ham?.tepsiBilgisi === true }
}
export function setTraySettings(degisiklik) {
  const yeni = { ...getTraySettings(), ...degisiklik }
  tepsiBellek = yeni
  try { localStorage.setItem(TEPSI_ANAHTARI, JSON.stringify(yeni)) } catch { /* bellekte kalır */ }
  return yeni
}

// ---------- Karar ----------
// Bildirim gelsin mi? Saf fonksiyon (spec §4, Review Focus 3):
//  msg: gelen mesaj satırı. DM'de thread_id, bahsetmede channel_id ve server_id (çağıran ekler) dolu.
//  selfId: kendi id'm. odakta: Voxen penceresi odakta mı. acikHedef: şu an açık konuşmanın id'si
//  (kanal id'si ya da DM konuşma id'si; yoksa null). durum: kendi durumum ('dnd' = Rahatsız etmeyin).
//  sessizSunucular: Set<serverId>. ayarlar: { masaustu }. tur: 'dm' | 'mention' | 'channel'
//  (bahsetmede mesajın beni andığını çağıran denetler: src/mentions.js mentionsUser; 'channel' (v0.13.0):
//  "Tüm mesajlar" düzeyindeki kanalın sıradan mesajı — düzey kararı src/bildirimDuzeyi.js'te).
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
  if ((tur === 'mention' || tur === 'channel') && sessizSunucular?.has?.(msg.server_id)) return false
  return true
}

// Gelen arama bildirimi gelsin mi? (DM araması, spec §2): "Rahatsız etmeyin"de, "Masaüstü bildirimleri"
// kapalıyken ve pencere odaktayken (kart zaten görünüyor) gelmez. Kart her durumda gösterilir.
export function shouldNotifyCall({ odakta, durum, ayarlar }) {
  if (ayarlar && ayarlar.masaustu === false) return false
  if (durum === 'dnd') return false
  return !odakta
}

function hedefId(msg, tur) {
  if (tur === 'dm') return msg.thread_id ?? null
  if (tur === 'mention' || tur === 'channel') return msg.channel_id ?? null
  return null
}

// ---------- Metinler ----------
// Başlık: DM için "Ad", bahsetme ve kanal mesajı için "Ad (#kanal, Sunucu)"
export function bildirimBasligi({ tur, ad, kanal, sunucu }) {
  return tur === 'mention' || tur === 'channel' ? `${ad} (#${kanal}, ${sunucu})` : ad
}

// Metin: mesajın ilk 100 karakteri (Türkçe/emoji karakterleri bölünmesin diye Array.from)
export function bildirimMetni(icerik) {
  return Array.from(String(icerik ?? '')).slice(0, METIN_MAX).join('')
}

// Birleşmiş bildirimin metni: "Ad: 3 yeni mesaj"
export function birlesikMetin(ad, sayi) {
  return `${ad}: ${sayi} yeni mesaj`
}

// Gelen arama bildiriminin metni: "Ayla seni arıyor"
export function aramaBildirimMetni(ad) {
  return `${ad} seni arıyor`
}

// ---------- Gösterim ve birleştirme ----------
// ac(hedef): bildirime tıklanınca hedefi açar; hedef { type: 'dm' | 'mention' | 'call', id, serverId? }.
// deps (yalnız testler için): { goster(bildirim) -> gösterildi mi, sesCal(), odakla() }.
// Dönen: { bildir({ hedef, ad, baslik, metin }), bildirArama({ id, ad }) -> kapat(), tikla(hedef), destroy() }
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

  // ozet (isteğe bağlı): birleşmiş özetin başlığı ve adı { baslik, ad }; verilmezse ilk bildirimin başlığı/adı.
  // Kanal bildirimlerinde özet kanalı anlatır ("#genel: 7 yeni mesaj"), ilk yazarı değil.
  // Anahtar hedefin türüyle ayrılır: aynı kanalda 'mention' (beni anan) ile 'channel' (sıradan) ayrı birleşir,
  // böylece kanal penceresi açıkken gelen anma hemen ve kendi metniyle gösterilir.
  function bildir({ hedef, ad, baslik, metin, ozet = null }) {
    if (kapandi || !hedef?.id) return
    const anahtar = `${hedef.type}:${hedef.id}`
    const kayan = hedef.type === 'channel'
    const acik = pencereler.get(anahtar)
    if (acik) {
      acik.sayi++ // süre içinde: sayılır, süre bitince özet gider
      if (kayan && Date.now() - acik.baslangic < notifyTiming.kayanEnFazlaMs) {
        clearTimeout(acik.zamanlayici)
        acik.zamanlayici = setTimeout(acik.bitir, notifyTiming.birlesmeMs)
      }
      return
    }
    const pencere = {
      sayi: 1, ad: ozet?.ad ?? ad, baslik: ozet?.baslik ?? baslik, hedef, zamanlayici: null, baslangic: Date.now(), bitir: null,
    }
    pencere.bitir = () => {
      pencereler.delete(anahtar)
      if (kapandi || pencere.sayi < 2) return
      goster({ id: yeniId(), baslik: pencere.baslik, metin: birlesikMetin(pencere.ad, pencere.sayi), hedef, etiket: anahtar, tikla })
    }
    pencere.zamanlayici = setTimeout(pencere.bitir, notifyTiming.birlesmeMs)
    pencereler.set(anahtar, pencere)
    const gosterildi = goster({ id: yeniId(), baslik, metin, hedef, etiket: anahtar, tikla })
    // Ses yalnız bildirim gerçekten gösterildiyse (ör. tarayıcıda izin yoksa ses de yok)
    if (gosterildi && getNotifySettings().ses) sesCal()
  }

  // Gelen arama: "Ad" / "Ad seni arıyor". Birleşmez, bildirim sesi çalmaz (zili kart çalar).
  // Tıklayınca pencere öne gelir ve ac({ type: 'call', id }) kartı gösterir; bildirimden kabul edilmez.
  // Dönen kapat(): kart kapanınca bildirim de kalkar (tarayıcıda; masaüstünde bildirim merkezinde kalır).
  // metin verilirse (grup araması: "Grup adı · berk arıyor", kartla aynı) o yazılır.
  function bildirArama({ id, ad, metin = null }) {
    if (kapandi || !id) return () => {}
    const hedef = { type: 'call', id }
    const sonuc = goster({ id: yeniId(), baslik: ad, metin: metin ?? aramaBildirimMetni(ad), hedef, etiket: `call:${id}`, tikla })
    return () => { try { sonuc?.close?.() } catch { /* zaten kapandı */ } }
  }

  return {
    bildir,
    bildirArama,
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
// Dönen: gösterilmediyse false; tarayıcıda Notification nesnesi (kapatılabilir), masaüstünde true.
// Masaüstünde izin sorulmaz, gösterilmiş sayılır.
function varsayilanGoster({ id, baslik, metin, hedef, etiket, tikla }) {
  if (isTauri()) {
    showDesktopNotification({ id, title: baslik, body: metin, extra: { hedef } })
    return true
  }
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return false
  try {
    const n = new Notification(baslik, { body: metin, icon: SIMGE, tag: etiket })
    n.onclick = () => { n.close(); tikla(hedef) }
    return n
  } catch { return false } // bazı tarayıcılar sayfadan bildirime izin vermez: sessizce geç
}

// Tarayıcıda bildirim izni bir kez istenir (ilk DM açılınca ya da Ayarlar'dan). Masaüstünde gerekmez.
// Reddedilirse bir şey söylenmez: bildirimler sessizce kapalı kalır.
// DM açılınca istek oturum başına en fazla bir kez yapılır (kişi soruyu kapatıp geçtiyse her DM'de
// yeniden sorulmasın). acik: true (Ayarlar'dan) bu sınırı yok sayar.
let izinSoruldu = false
export async function requestNotifyPermission({ acik = false } = {}) {
  if (isTauri() || typeof Notification === 'undefined') return
  if (Notification.permission !== 'default') return
  // Açık istek (Ayarlar'daki "Bildirimlere izin ver") "Masaüstü bildirimleri" kapalı olsa da sorar (tur 1, K8)
  if (!acik && !getNotifySettings().masaustu) return
  if (izinSoruldu && !acik) return
  izinSoruldu = true
  try { await Notification.requestPermission() } catch { /* sessizce geç */ }
}

// Tarayıcının bildirim izni: 'granted' | 'denied' | 'default'; masaüstünde ya da API yoksa 'yok'
// (Ayarlar > Bildirimler'deki "Bildirimlere izin ver" düğmesi bunu okur; v0.13.0).
export function bildirimIzni() {
  if (isTauri() || typeof Notification === 'undefined' || !Notification) return 'yok'
  return Notification.permission ?? 'yok'
}
