// Canlı varlık (presence): herkes tek bir "presence:voxen" kanalına durumunu yazar.
// Yalnız çevrimiçi durumu (status, statusText) ve pencere kimliği (clientId) gider.
// Sesli kanal durumu (kim hangi kanalda, susturma, kamera, ekran) voice_states tablosundadır:
// Supabase varlık çağrılarını kişi başı 30 sn'de 5 ile sınırlar, hızlı tıklamalara yetmiyordu.
import { supabase } from '../lib/supabase.js'
import { buildPresenceMap, clampStatusText, computeStatus } from './status.js'

const dinleyiciler = new Set()
let sonHarita = new Map()
let sonHam = {} // presenceState() ham hali: { userId: [girdiler] } (her sekme/pencere ayrı girdi)

// Bu pencerenin kimliği: aynı hesap iki pencerede açıksa girdileri ayırt etmek için
export const CLIENT_ID = globalThis.crypto?.randomUUID?.() ?? String(Math.random()).slice(2)

// Bu kişinin varlıkta görünen pencerelerinin kimlikleri (dizi)
export function onlineClientIds(userId) {
  return (sonHam[userId] ?? []).map((g) => g.clientId).filter(Boolean)
}

// Bu kişinin verilen penceresi (clientId) şu an çevrimiçi mi?
// Sesli durum satırını yazan pencere hâlâ açık mı diye bakmak için (aynı hesap iki pencerede).
export function isClientOnline(userId, clientId) {
  return (sonHam[userId] ?? []).some((g) => g.clientId === clientId)
}

// Kim çevrimiçi değişince cb(Map<userId, durum>) çağrılır. Dönen fonksiyon dinlemeyi bırakır.
export function onPresenceChange(cb) {
  dinleyiciler.add(cb)
  cb(sonHarita) // o ana kadarki durumu hemen ver
  return () => dinleyiciler.delete(cb)
}

// (test için) kaç dinleyici kayıtlı
export function presenceListenerCount() { return dinleyiciler.size }

function haritayiYay(harita, ham = {}) {
  sonHarita = harita
  sonHam = ham
  for (const cb of dinleyiciler) cb(harita)
}

const KONU = 'presence:voxen'
let oncekiKapanis = null // son stop()'un Promise'i: yeni kanal ancak o bitince açılır

// Supabase sunucusu bir istemciye 30 saniyede en fazla 5 varlık çağrısı (track + untrack) izin verir.
// Aşılırsa kanalı KAPATIR ve son durum kimseye ulaşmaz (hızlı Sustur/Sağırlaştır'da simge takılıyordu).
// Bu yüzden kendimiz 30 sn'de en fazla 4 track göndeririz (1 tanesi çıkıştaki untrack için boş kalır);
// fazlası beklenir ve yer açılınca EN GÜNCEL durum tek seferde gider.
// Ayrıca iki gönderim arasında en az gapMs olur: hızlı tıklamalar (ör. 10 ms arayla) tek gönderimde birleşir.
// (Testler sınırı burada değiştirebilir: örn. sınırı denemeyen arayüz testleri sınırsız yapar.)
export const presenceLimits = { maxCalls: 4, windowMs: 30000, gapMs: 250 }
const TEKRAR_DENE_MS = 2000 // track() hata/zaman aşımı dönerse bu kadar sonra yeniden gönder
// Sunucu kanalı kapatırsa yeniden açmadan önce beklenecek süreler: her kapanışta bir sonrakine geçer
// (3 → 6 → 12 → 30 sn, sonra hep 30). Kanal STABIL_MS boyunca sorunsuz bağlı kalırsa yine 3'ten başlar.
const YENIDEN_AC_MS = [3000, 6000, 12000, 30000]
const STABIL_MS = 30000

// Son varlık çağrılarının (track + untrack) zamanları. Modül düzeyinde: Çıkış'tan hemen sonra yeniden
// giriş yapılınca yeni trackPresence de eskisinin gönderimlerini sayar (sunucu aynı istemciyi sayıyor).
let gonderimler = []
// (test için) gönderim geçmişini sıfırlar
export function resetPresenceLimiter() { gonderimler = [] }

// Kanala katılır ve kendi durumunu yayınlar.
// update(partial): durumu değiştirir; stop(): yayını bırakır (karşıdakiler çevrimdışı görür).
//
// Önemli noktalar (sesli kanal sinyalindeki gibi, bkz. src/voice/signal.js):
//  1) realtime-js aynı konu için, eski kanalın ayrılması bitene kadar ESKİ kanal nesnesini geri verir;
//     ona subscribe() hiçbir şey yapmaz. Bu yüzden önceki stop()'un bitmesini bekleyip sonra açarız
//     (örn. Çıkış'tan hemen sonra yeniden giriş).
//  2) Kanal "private": sadece giriş yapmış (JWT'li) kullanıcılar katılabilir.
//     Yetki kuralları: supabase/migrations/004_presence_auth_and_checks.sql
//  3) Gönderimler sınırlıdır (yukarıya bak) ve her zaman en güncel durumun tamamı gönderilir;
//     böylece arada kaybolan bir gönderim sorun olmaz, son durum mutlaka gider.
export function trackPresence(userId, { status = 'online', statusText = '' } = {}) {
  let durum = { status, statusText: clampStatusText(statusText), clientId: CLIENT_ID }
  let hazir = false // kanala bağlanınca true
  let kapali = false // stop() çağrıldı
  let kapanis = null
  let kanal = null // kurulunca dolar (yeniden açılırsa yenisi)
  let bekleyen = null // sıradaki gönderimin zamanlayıcısı
  let yenidenAcma = null // kanalı yeniden açma zamanlayıcısı
  let kapanisSayisi = 0 // art arda kaç kez kapandı (bekleme süresini seçer)
  let baglanmaZamani = 0 // son SUBSCRIBED zamanı (sorunsuz bağlı kaldı mı?)

  // En güncel durumu gönderir; sınır doluysa yer açılınca gönderilmek üzere sıraya koyar.
  function gonder() {
    if (!hazir || kapali || bekleyen) return // bekleyen varsa o zaten en güncel durumu gönderecek
    const simdi = Date.now()
    gonderimler = gonderimler.filter((t) => simdi - t < presenceLimits.windowMs)
    if (gonderimler.length >= presenceLimits.maxCalls) {
      // Sınır dolu: en eski gönderim pencereden çıkınca tekrar dene
      bekleSonraGonder(gonderimler[0] + presenceLimits.windowMs - simdi)
      return
    }
    const son = gonderimler.at(-1)
    if (son != null && simdi - son < presenceLimits.gapMs) {
      // Az önce gönderdik: kısa bir süre bekle, bu arada gelen değişiklikler de aynı gönderime katılır
      bekleSonraGonder(son + presenceLimits.gapMs - simdi)
      return
    }
    gonderimler.push(simdi)
    const k = kanal
    // Sonuç 'ok' değilse (hata / zaman aşımı) durum sunucuya ulaşmamış olabilir: biraz sonra yeniden gönder
    Promise.resolve(k.track(durum)).then(
      (sonuc) => { if ((sonuc === 'error' || sonuc === 'timed out') && k === kanal) bekleSonraGonder(TEKRAR_DENE_MS) },
      () => { if (k === kanal) bekleSonraGonder(TEKRAR_DENE_MS) },
    )
  }

  function bekleSonraGonder(ms) {
    if (kapali || bekleyen) return
    bekleyen = setTimeout(() => { bekleyen = null; gonder() }, Math.max(0, ms))
  }

  // Kanalı açar (ilk kez ya da sunucu kapattıktan sonra yeniden)
  function kanalAc() {
    const k = supabase.channel(KONU, { config: { private: true, presence: { key: userId } } })
    kanal = k
    k.on('presence', { event: 'sync' }, () => {
      if (kapali || k !== kanal) return
      const ham = k.presenceState()
      haritayiYay(buildPresenceMap(ham), ham)
    })
    k.subscribe((s) => {
      if (kapali || k !== kanal) return
      if (s === 'SUBSCRIBED') {
        hazir = true
        baglanmaZamani = Date.now()
        gonder() // bağlanana kadar değişenler de en güncel haliyle gider
      } else if (s === 'CHANNEL_ERROR' || s === 'TIMED_OUT') {
        hazir = false // realtime-js kendisi yeniden bağlanır; SUBSCRIBED gelince son durum gider
      } else if (s === 'CLOSED') {
        // Sunucu kanalı kapattı (örn. varlık sınırı aşıldı): biraz bekleyip yeniden aç.
        // Uzun süre sorunsuz bağlıydıysa bekleme baştan (3 sn) başlar; yoksa her seferinde artar.
        hazir = false
        if (yenidenAcma) return
        if (baglanmaZamani && Date.now() - baglanmaZamani >= STABIL_MS) kapanisSayisi = 0
        baglanmaZamani = 0
        const bekle = YENIDEN_AC_MS[Math.min(kapanisSayisi, YENIDEN_AC_MS.length - 1)]
        kapanisSayisi++
        yenidenAcma = setTimeout(async () => {
          // Kapalıyken oturum anahtarı (JWT) yenilenmiş olabilir: açmadan önce realtime'a ver
          try { await supabase.realtime?.setAuth?.() } catch { /* anahtar yoksa katılma reddedilir */ }
          yenidenAcma = null
          if (!kapali) kanalAc()
        }, bekle)
      }
    })
    return k
  }

  // Kanalı asenkron kur: önce önceki kapanışı bekle, sonra oturum anahtarını realtime'a ver
  const kanalHazir = (async () => {
    try { await oncekiKapanis } catch { /* önemli değil */ }
    try { await supabase.realtime?.setAuth?.() } catch { /* anahtar yoksa katılma reddedilir */ }
    if (kapali) return null
    return kanalAc()
  })()

  return {
    update(partial) {
      durum = { ...durum, ...partial }
      durum.statusText = clampStatusText(durum.statusText)
      gonder()
    },
    // Yayını bırakır. Dönen Promise, kanal realtime-js'den tamamen çıkınca biter.
    stop() {
      if (kapali) return kapanis
      kapali = true
      hazir = false
      clearTimeout(bekleyen)
      clearTimeout(yenidenAcma)
      haritayiYay(new Map())
      kapanis = kanalHazir
        .then(() => {
          const k = kanal // yeniden açıldıysa en son kanal
          if (!k) return null
          gonderimler.push(Date.now()) // untrack de sunucuda bir varlık çağrısı sayılır
          k.untrack?.()
          return supabase.removeChannel(k)
        })
        .catch(() => {})
        .finally(() => { if (oncekiKapanis === kapanis) oncekiKapanis = null })
      oncekiKapanis = kapanis
      return kapanis
    },
  }
}

// Kullanıcının hareketini izleyip durumu otomatik günceller.
// getPrefs() → { dnd, statusText } (tarayıcıda saklanan tercihler).
// Dönen: { refresh(), update(), activity(), stop() } — refresh(): tercihler değişince hemen yeniden hesapla.
// isActive(): true dönerse (örn. konuşma kapısı açık: oyunda bas-konuş ile konuşuyor) kişi boşta sayılmaz.
// activity(): fare/klavye dışındaki bir hareketi bildirir (konuşma kapısı açılınca çağrılır).
export function startPresence(userId, getPrefs, { target = window, isActive = () => false } = {}) {
  let sonHareket = Date.now()
  let sonKayit = 0 // hareketleri saniyede en fazla bir kez say
  const hesapla = () => {
    const p = getPrefs()
    return {
      status: computeStatus({ lastActivityMs: sonHareket, nowMs: Date.now(), manual: p.dnd ? 'dnd' : null }),
      statusText: clampStatusText(p.statusText),
    }
  }

  let son = hesapla()
  const izleyici = trackPresence(userId, son)

  // Sadece durum ya da yazı DEĞİŞTİYSE yayınla (gereksiz track çağrısı yapma)
  function yenile() {
    if (isActive()) sonHareket = Date.now() // konuşuyor: hâlâ başında
    const yeni = hesapla()
    if (yeni.status !== son.status || yeni.statusText !== son.statusText) {
      son = yeni
      izleyici.update(yeni)
    }
  }

  function hareket() {
    const simdi = Date.now()
    if (simdi - sonKayit < 1000) return
    sonKayit = simdi
    sonHareket = simdi
    if (son.status === 'idle') yenile() // boştayken dönünce 30 sn beklemeden çevrimiçi ol
  }

  const olaylar = ['mousemove', 'keydown', 'mousedown', 'wheel', 'focus']
  for (const o of olaylar) target.addEventListener(o, hareket, true)
  const sayac = setInterval(yenile, 30000) // 30 sn'de bir yeniden hesapla

  return {
    refresh: yenile,
    activity: hareket,
    update: (partial) => izleyici.update(partial),
    stop() {
      clearInterval(sayac)
      for (const o of olaylar) target.removeEventListener(o, hareket, true)
      return izleyici.stop() // Promise: kanal tamamen bırakılınca biter
    },
  }
}
