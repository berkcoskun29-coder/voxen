// DM sesli arama: RPC'ler (başlat, kabul, bitir, canlılık) ve "user:<uid>" konusundaki "arama"
// olaylarını ayrıştırma. Kurallar veritabanında (supabase/migrations/008_dm_arama.sql): dm_calls
// yalnız iki tarafa açık, yazma yalnız RPC ile; engel ve meşgul denetimi sunucuda.
// Sinyal konusu: private "dm-voice:<arama id>" (yalnız iki taraf, yalnız arama bitmemişken).
import { supabase } from '../lib/supabase.js'
import { rpcHatasi } from './friends.js'

// Bitiş nedenleri (end_dm_call'ın kabul ettikleri)
export const BITIS_NEDENLERI = ['cancel', 'decline', 'timeout', 'hangup', 'lost']

// Sinyal konusu
export const callTopic = (callId) => `dm-voice:${callId}`

// Arama bağlamında hata metinleri. Engel kodları 007'deki gibi (BLOCKED_DM ve NOT_ALLOWED aynı
// metin: engellenen kişi engellendiğini anlamaz). BUSY metnindeki "Ad" çağıran tarafta yerleştirilir:
// mesgulMetni(ad) ya da err.code === 'BUSY' iken kendi metnini kurar.
// ALREADY_IN_CALL: bu kişiyle zaten süren bir arama var (başka penceremizde ya da birleşmiş arama).
const ARAMA_OZEL = { BUSY: 'Ad şu an başka bir aramada.', ALREADY_IN_CALL: 'Zaten bir aramadasın.' }

// "Ad şu an başka bir aramada." -> "Ayla şu an başka bir aramada."
export function mesgulMetni(ad) {
  return `${ad} şu an başka bir aramada.`
}

// dm_calls satırı -> { id, status }
function arama(r) {
  return { id: r?.id ?? null, status: r?.status ?? null }
}

// Arama başlatır. Dönüş: { id, status }.
//  status 'ringing': yeni arama çalıyor.
//  status 'active': karşı taraf da beni arıyordu, onun araması kabul edildi (ikimiz de konuşmaya girdik).
// Hatada Türkçe metinli Error, err.code: 'BUSY' | 'ALREADY_IN_CALL' | 'BLOCKED_DM' | 'NOT_ALLOWED' | null.
export async function startCall(threadId) {
  const { data, error } = await supabase.rpc('start_dm_call', { tid: threadId })
  if (error) throw rpcHatasi(error, ARAMA_OZEL)
  return arama(data)
}

// Gelen aramayı kabul eder. Dönüş: { id, status }. status 'ended' ise arama bu arada bitmiş.
export async function answerCall(id) {
  const { data, error } = await supabase.rpc('answer_dm_call', { id })
  if (error) throw rpcHatasi(error, ARAMA_OZEL)
  return arama(data)
}

// Aramayı bitirir (iki taraf da). reason: 'cancel' | 'decline' | 'timeout' | 'hangup' | 'lost'.
// Zaten bitmişse sessizce geçer; kayıt satırını ("📞 ...") sunucu tek kez yazar.
export async function endCall(id, reason) {
  const { error } = await supabase.rpc('end_dm_call', { id, reason })
  if (error) throw rpcHatasi(error, ARAMA_OZEL)
}

// Aramanın canlı olduğunu bildirir (20 sn'de bir). Dönüş: true = sürüyor, false = bitmiş/bayat.
export async function pingCall(id) {
  const { data, error } = await supabase.rpc('ping_dm_call', { id })
  if (error) throw rpcHatasi(error, ARAMA_OZEL)
  return data === true
}

// Aramanın şu anki durumu (kaçan "arama" olayını telafi etmek için; RLS: yalnız iki taraf okur).
// Dönüş: { status: 'ringing'|'active'|'ended', reason } ya da satır yoksa/görünmüyorsa null.
export async function getCallStatus(id) {
  const { data, error } = await supabase.from('dm_calls').select('status, end_reason').eq('id', id).maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) return null
  return { status: data.status ?? null, reason: data.end_reason ?? null }
}

// "user:<uid>" konusundaki "arama" yayınının yükü -> { callId, threadId, status, caller, reason }.
// reason: bitiş nedeni (yalnız status 'ended' iken; yoksa null). Bozuk yükte null.
export function parseCallEvent(payload) {
  const p = payload ?? {}
  if (!p.call_id || !p.thread_id || !['ringing', 'active', 'ended'].includes(p.status)) return null
  return {
    callId: p.call_id,
    threadId: p.thread_id,
    status: p.status,
    caller: p.caller ?? null,
    reason: p.reason ?? null,
  }
}
