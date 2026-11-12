// Sesli kanal durumu (voice_states tablosu): kim hangi sesli kanalda, susturulmuş/sağır mı,
// kamerası/ekranı açık mı. Eskiden varlık (presence) kanalından gidiyordu; Supabase orada kişi başı
// 30 sn'de en fazla 5 çağrıya izin verdiği için hızlı tıklamalarda durum kayboluyordu.
// Tablo kuralları: supabase/migrations/005_voice_states.sql
import { supabase } from '../lib/supabase.js'
import { CLIENT_ID } from '../presence/presence.js'

// Veritabanı satırını uygulamanın kullandığı biçime çevirir
export function rowToVoiceState(r) {
  return {
    userId: r.user_id,
    serverId: r.server_id,
    channelId: r.channel_id,
    clientId: r.client_id,
    muted: !!r.muted,
    deafened: !!r.deafened,
    camera: !!r.camera,
    screen: !!r.screen,
  }
}

// Sunucudaki tüm sesli durumlar (dizi)
export async function listVoiceStates(serverId) {
  const { data, error } = await supabase.from('voice_states').select('*').eq('server_id', serverId)
  if (error) throw new Error(error.message)
  return (data ?? []).map(rowToVoiceState)
}

// Kendi satırımız (hangi sunucuda olursa olsun); yoksa null
export async function getMyVoiceState(userId) {
  const { data, error } = await supabase.from('voice_states').select('*').eq('user_id', userId).maybeSingle()
  if (error) throw new Error(error.message)
  return data ? rowToVoiceState(data) : null
}

// Eski (artık açık olmayan bir pencereden kalmış) satırı siler. client_id de eşleşmeli:
// bu arada başka pencere yeni bir satır yazdıysa ona dokunulmaz.
export async function deleteStaleVoiceState(userId, clientId) {
  const { error } = await supabase.from('voice_states').delete().eq('user_id', userId).eq('client_id', clientId)
  if (error) throw new Error(error.message)
}

// ---------- Abonelik ----------

// Sunucudaki sesli durumları canlı izler. onChange(Map<userId, durum>) her değişiklikte çağrılır.
// onDelete(userId): bir satır silinince (örn. kendi satırımızı başka penceremiz sildiyse yeniden yazmak için).
// Dönen fonksiyon aboneliği kapatır.
//  - Her bağlanışta (ilk ve yeniden bağlanma) liste baştan yüklenir: kopukken kaçanlar da gelir.
//  - Liste yüklenirken gelen olaylar saklanır ve liste gelince sırayla yeniden uygulanır.
//  - Realtime silme olaylarını filtreleyemez ve RLS açıkken eski satırdan yalnız user_id'yi verir;
//    bu yüzden silmeler ayrıca filtresiz dinlenir ve user_id ile işlenir (kişi başı tek satır var).
let abonelikSayaci = 0
export function subscribeVoiceStates(serverId, onChange, { onDelete } = {}) {
  let kapandi = false
  let harita = new Map()
  let araOlaylar = null // liste yüklenirken gelen olaylar (null = yükleme yok)
  let yuklemeNo = 0

  function yay() { if (!kapandi) onChange(new Map(harita)) }

  function uygula(olay) {
    if (olay.eventType === 'DELETE') {
      harita.delete(olay.old?.user_id)
      return
    }
    const d = rowToVoiceState(olay.new)
    // Başka sunucuya geçtiyse bu sunucunun listesinden çıkar
    if (d.serverId === serverId) harita.set(d.userId, d)
    else harita.delete(d.userId)
  }

  function olayGeldi(olay) {
    if (kapandi) return
    if (olay.eventType === 'DELETE') onDelete?.(olay.old?.user_id)
    if (araOlaylar) { araOlaylar.push(olay); return }
    uygula(olay)
    yay()
  }

  async function yukle() {
    const no = ++yuklemeNo
    araOlaylar = []
    try {
      const liste = await listVoiceStates(serverId)
      if (kapandi || no !== yuklemeNo) return
      harita = new Map(liste.map((d) => [d.userId, d]))
      for (const o of araOlaylar) uygula(o)
    } catch {
      if (kapandi || no !== yuklemeNo) return
      for (const o of araOlaylar) uygula(o) // liste gelmedi: en azından olaylar kaybolmasın
    }
    araOlaylar = null
    yay()
  }

  // Her abonelik benzersiz konu alır (messages.js'deki gibi: yarı kapanmış kanal yeniden kullanılmasın)
  const tablo = { schema: 'public', table: 'voice_states' }
  const kanal = supabase
    .channel(`voice_states:${serverId}:${++abonelikSayaci}`)
    .on('postgres_changes', { event: '*', ...tablo, filter: `server_id=eq.${serverId}` }, olayGeldi)
    .on('postgres_changes', { event: 'DELETE', ...tablo }, olayGeldi)
    .subscribe((durum) => {
      if (durum === 'SUBSCRIBED' && !kapandi) yukle()
    })
  return () => { kapandi = true; supabase.removeChannel(kanal) }
}

// ---------- Yazma kuyruğu (kendi satırımız) ----------
// Arayüz her değişiklikte upsertVoiceState / clearVoiceState çağırır; burada:
//  - Hızlı değişiklikler coalesceMs içinde tek yazmada birleşir (her zaman EN GÜNCEL durum gider).
//  - Yazmalar sırayla yapılır (aynı anda tek istek), sıra karışmaz.
//  - Başka kanala geçişte önce eski satır silinir: eski sunucudakiler "ayrıldı" olayını alsın.
//  - Geçici hata (ağ, 5xx, 401/408/429) olursa retryMs sonra yeniden denenir (örn. Ayrıl'daki silme mutlaka gitsin).
//  - Kalıcı hata (4xx: yetki/RLS, olmayan kanal/FK) yeniden denenmez: "ayrıldı" (satır yok) sayılır.
export const voiceStateTiming = { coalesceMs: 150, retryMs: 2000 }

let istenen = null // olması gereken satır (null = satır olmamalı)
let yazilan = null // sunucuda olduğunu bildiğimiz satırımız (null = yok)
let kullanici = null // satırın sahibi (silmek için)
let zamanlayici = null
let calisiyor = false
let bekleyenler = [] // flushVoiceStates() sözleri

// Bizim satırımız biçiminde (veritabanı sütunları)
function satirYap(d) {
  return {
    user_id: d.userId,
    server_id: d.serverId,
    channel_id: d.channelId,
    client_id: CLIENT_ID,
    muted: !!d.muted,
    deafened: !!d.deafened,
    camera: !!d.camera,
    screen: !!d.screen,
  }
}

function ayni(a, b) {
  if (a === null || b === null) return a === b
  return ['user_id', 'server_id', 'channel_id', 'muted', 'deafened', 'camera', 'screen'].every((k) => a[k] === b[k])
}

function bittiMi() { return !calisiyor && !zamanlayici && ayni(istenen, yazilan) }

function haberVer() {
  if (!bittiMi()) return
  const liste = bekleyenler
  bekleyenler = []
  for (const r of liste) r()
}

function planla(ms) {
  if (zamanlayici || calisiyor) return // zaten planlı; çalışan iş de bitince tekrar bakar
  zamanlayici = setTimeout(calistir, ms)
}

// Hata kalıcı mı? 4xx tekrar denemekle düzelmez; şunlar hariç (geçici sayılır, yeniden denenir):
// 401 (oturum anahtarı o an yenileniyordu), 408 (zaman aşımı), 429 (çok istek).
const GECICI_4XX = [401, 408, 429]
function kaliciMi(status) {
  return status >= 400 && status < 500 && !GECICI_4XX.includes(status)
}
// Supabase cevabındaki hatayı fırlatır; kalıcıysa e.kalici = true
function hataVarsa({ error, status }) {
  if (!error) return
  const e = new Error(error.message)
  e.kalici = kaliciMi(status ?? 0)
  throw e
}

async function sil() {
  hataVarsa(await supabase.from('voice_states').delete().eq('user_id', kullanici).eq('client_id', CLIENT_ID))
}

async function yaz(satir) {
  hataVarsa(await supabase.from('voice_states').upsert(satir))
}

async function calistir() {
  zamanlayici = null
  calisiyor = true
  try {
    while (!ayni(istenen, yazilan)) {
      const hedef = istenen
      if (hedef === null) {
        await sil()
        yazilan = null
      } else {
        // Başka kanala geçiş: önce eski satırı sil
        if (yazilan && yazilan.channel_id !== hedef.channel_id) {
          await sil()
          yazilan = null
        }
        await yaz(hedef)
        yazilan = hedef
      }
    }
    calisiyor = false
  } catch (e) {
    calisiyor = false
    if (e.kalici) {
      // Tekrar denemek düzelmez (örn. kanal silindi, yetki yok): satırımız yok say, sonraki değişikliği bekle
      istenen = null
      yazilan = null
    } else {
      // Ağ hatası: biraz sonra en güncel durumla yeniden dene
      planla(voiceStateTiming.retryMs)
    }
  }
  haberVer()
}

// Sesli durumumuzu yazar: { userId, serverId, channelId, muted, deafened, camera, screen }
export function upsertVoiceState(d) {
  kullanici = d.userId
  istenen = satirYap(d)
  planla(voiceStateTiming.coalesceMs)
}

// Sesli kanaldan ayrıldık: satırımızı sil. { now: true } -> beklemeden (sayfa kapanırken).
export function clearVoiceState(userId, { now = false } = {}) {
  kullanici = userId ?? kullanici
  istenen = null
  if (now && zamanlayici) {
    clearTimeout(zamanlayici)
    zamanlayici = null
  }
  if (now) {
    if (!calisiyor) calistir()
  } else {
    planla(voiceStateTiming.coalesceMs)
  }
}

// Satırımız bizden habersiz silindi (örn. başka penceremiz bizi kapanmış sandı): sesli kanaldaysak yeniden yaz
export function reassertVoiceState() {
  if (istenen === null) return // ayrıldık: yazacak bir şey yok
  yazilan = null
  planla(voiceStateTiming.coalesceMs)
}

// Bekleyen yazmalar bitince çözülen Promise (testler ve kapanış için)
export function flushVoiceStates() {
  return new Promise((r) => {
    bekleyenler.push(r)
    haberVer()
  })
}

// (test için) kuyruğu sıfırlar
export function resetVoiceStateWriter() {
  clearTimeout(zamanlayici)
  zamanlayici = null
  calisiyor = false
  istenen = null
  yazilan = null
  kullanici = null
  bekleyenler = []
}
