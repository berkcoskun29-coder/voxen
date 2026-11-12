// Canlı varlık (presence): herkes tek bir "presence:voxen" kanalına durumunu yazar.
import { supabase } from '../lib/supabase.js'
import { buildPresenceMap, clampStatusText, computeStatus } from './status.js'

const dinleyiciler = new Set()
let sonHarita = new Map()
let sonHam = {} // presenceState() ham hali: { userId: [girdiler] } (her sekme/pencere ayrı girdi)

// Bu pencerenin kimliği: aynı hesap iki pencerede açıksa girdileri ayırt etmek için
export const CLIENT_ID = globalThis.crypto?.randomUUID?.() ?? String(Math.random()).slice(2)

// Aynı hesabın BAŞKA bir penceresi/istemcisi sesli kanalda mı? Öyleyse o kanalın id'si, yoksa null.
export function otherClientVoiceChannel(userId) {
  const girdiler = sonHam[userId] ?? []
  const baska = girdiler.find((g) => g.clientId !== CLIENT_ID && g.voiceChannelId != null)
  return baska?.voiceChannelId ?? null
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

// Kanala katılır ve kendi durumunu yayınlar.
// update(partial): durumu değiştirir; stop(): yayını bırakır (karşıdakiler çevrimdışı görür).
//
// Önemli iki nokta (sesli kanal sinyalindeki gibi, bkz. src/voice/signal.js):
//  1) realtime-js aynı konu için, eski kanalın ayrılması bitene kadar ESKİ kanal nesnesini geri verir;
//     ona subscribe() hiçbir şey yapmaz. Bu yüzden önceki stop()'un bitmesini bekleyip sonra açarız
//     (örn. Çıkış'tan hemen sonra yeniden giriş).
//  2) Kanal "private": sadece giriş yapmış (JWT'li) kullanıcılar katılabilir.
//     Yetki kuralları: supabase/migrations/004_presence_auth_and_checks.sql
export function trackPresence(userId, { status = 'online', statusText = '', voiceChannelId = null } = {}) {
  let durum = { status, statusText: clampStatusText(statusText), voiceChannelId, clientId: CLIENT_ID }
  let hazir = false // kanala bağlanınca true
  let kapali = false // stop() çağrıldı
  let kapanis = null
  let kanal = null // kurulunca dolar

  // Kanalı asenkron kur: önce önceki kapanışı bekle, sonra oturum anahtarını realtime'a ver
  const kanalHazir = (async () => {
    try { await oncekiKapanis } catch { /* önemli değil */ }
    try { await supabase.realtime?.setAuth?.() } catch { /* anahtar yoksa katılma reddedilir */ }
    if (kapali) return null
    kanal = supabase.channel(KONU, { config: { private: true, presence: { key: userId } } })
    kanal.on('presence', { event: 'sync' }, () => {
      if (kapali) return
      const ham = kanal.presenceState()
      haritayiYay(buildPresenceMap(ham), ham)
    })
    kanal.subscribe((s) => {
      if (s === 'SUBSCRIBED' && !kapali) {
        hazir = true
        kanal.track(durum) // bağlanana kadar değişenler de en güncel haliyle gider
      }
    })
    return kanal
  })()

  return {
    update(partial) {
      durum = { ...durum, ...partial }
      durum.statusText = clampStatusText(durum.statusText)
      if (hazir && !kapali) kanal.track(durum)
    },
    // Yayını bırakır. Dönen Promise, kanal realtime-js'den tamamen çıkınca biter.
    stop() {
      if (kapali) return kapanis
      kapali = true
      hazir = false
      haritayiYay(new Map())
      kapanis = kanalHazir
        .then((k) => {
          if (!k) return null
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
  const izleyici = trackPresence(userId, { ...son, voiceChannelId: null })

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
    update: (partial) => izleyici.update(partial), // örn. sesli kanal (Görev 7)
    stop() {
      clearInterval(sayac)
      for (const o of olaylar) target.removeEventListener(o, hareket, true)
      return izleyici.stop() // Promise: kanal tamamen bırakılınca biter
    },
  }
}
