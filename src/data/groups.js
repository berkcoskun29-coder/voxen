// Grup DM (v0.9.0): grup listesi, kurma/ekleme/çıkarma/ayrılma/ad, sessize alma ve grup araması.
// Kurallar veritabanında (supabase/migrations/011_grup_dm.sql): grup bir dm_threads satırıdır (is_group),
// üyeler dm_members'ta. Mesaj, tepki, yanıt, sabit ve ekler bire bir DM'in yollarını kullanır (dms.js dmSource).
// Grup araması: dm_calls (is_group) + dm_call_members; olay "user:<uid>" konusunda "grup_arama".
import { supabase } from '../lib/supabase.js'
import { rpcHatasi } from './friends.js'

export const GRUP_EN_AZ = 3 // kendin dahil
export const GRUP_EN_FAZLA = 10
export const GRUP_ADI_MAX = 100

// Grup hata kodlarının Türkçesi (CANNOT_ADD gizli koddur: arkadaş değil ya da engel, ikisi aynı metin)
export const GRUP_HATALARI = {
  CANNOT_ADD: 'Bu kişi eklenemedi.',
  ALREADY_MEMBER: 'Bu kişi zaten grupta.',
  TOO_FEW: 'Grup en az 3 kişi olmalı.',
  GROUP_FULL: 'Grup en fazla 10 kişi olabilir.',
  TOO_MANY: 'En fazla 100 gruba üye olabilirsin.',
  NOT_ALLOWED: 'Bunu yapamazsın.',
  ALREADY_IN_CALL: 'Zaten bir aramadasın.',
  CALL_FULL: 'Arama dolu (en fazla 10 kişi).',
}

async function cagir(ad, argumanlar) {
  const { data, error } = await supabase.rpc(ad, argumanlar)
  if (error) throw rpcHatasi(error, GRUP_HATALARI)
  return data
}

// Üye listesindeki bir kişi
function kisi(u) {
  return { id: u?.id ?? null, username: u?.username ?? '', color: u?.color ?? null, avatar_url: u?.avatar_url ?? null }
}

// group_dm_list satırı -> konuşma nesnesi (dms.js konusma() ile aynı alanlar + grup alanları).
// other: null (grupta tek karşı taraf yok). call: süren grup araması { id, count } ya da null.
function grup(r) {
  return {
    id: r.thread_id,
    isGroup: true,
    name: r.name ?? null,
    ownerId: r.owner_id ?? null,
    members: Array.isArray(r.members) ? r.members.map(kisi) : [],
    other: null,
    createdAt: r.created_at ?? null,
    lastMessageAt: r.last_message_at ?? null,
    unread: r.unread ?? 0,
    canSend: true,
    muted: r.muted === true,
    call: r.call_id ? { id: r.call_id, count: r.call_count ?? 0 } : null,
  }
}

// Gruplarım (gizlenenler hariç), son mesaja göre. Hata olursa fırlatır (app.js yok sayar).
export async function fetchGroupList() {
  const { data, error } = await supabase.rpc('group_dm_list')
  if (error) throw new Error(error.message)
  return (data ?? []).map(grup)
}

// Grubun görünen adı: adı varsa o; yoksa diğer üyelerin adları virgülle (katılma sırasıyla).
// Kimse kalmadıysa "Grup".
export function grupAdi(thread, selfId) {
  if (thread?.name) return thread.name
  const adlar = (thread?.members ?? []).filter((u) => u.id !== selfId).map((u) => u.username).filter(Boolean)
  return adlar.length ? adlar.join(', ') : 'Grup'
}

// Rozet için ilk iki üye (kendin hariç; yetmezse kendin de)
export function rozetUyeleri(thread, selfId) {
  const uyeler = thread?.members ?? []
  const digerleri = uyeler.filter((u) => u.id !== selfId)
  return (digerleri.length >= 2 ? digerleri : [...digerleri, ...uyeler.filter((u) => u.id === selfId)]).slice(0, 2)
}

// Kurar. uyeIdleri: diğer üyeler (kendin hariç). ad: boş olabilir. Dönüş: konuşma id'si.
export async function createGroup(uyeIdleri, ad = '') {
  const temiz = String(ad ?? '').trim()
  return cagir('create_group_dm', { uyeler: uyeIdleri, ad: temiz || null })
}

export async function addGroupMember(threadId, userId) {
  await cagir('add_group_member', { tid: threadId, uid: userId })
}

export async function removeGroupMember(threadId, userId) {
  await cagir('remove_group_member', { tid: threadId, uid: userId })
}

export async function leaveGroup(threadId) {
  await cagir('leave_group', { tid: threadId })
}

// Boş ad grubun adını kaldırır (liste üyelerin adlarını gösterir)
export async function renameGroup(threadId, ad) {
  const temiz = String(ad ?? '').trim()
  await cagir('rename_group', { tid: threadId, ad: temiz || null })
}

// ---------- Sessize alma (dm_mutes; mutes.js'teki sunucu karşılığıyla aynı kalıp) ----------

export async function muteDm(threadId) {
  const { error } = await supabase.from('dm_mutes').insert({ thread_id: threadId })
  if (error && error.code !== '23505') throw new Error(error.message) // 23505: zaten sessizde
}

export async function unmuteDm(threadId) {
  const { error } = await supabase.from('dm_mutes').delete().eq('thread_id', threadId)
  if (error) throw new Error(error.message)
}

// ---------- Grup araması ----------

// dm_calls satırı -> { id, status, caller, isGroup }
function arama(r) {
  return { id: r?.id ?? null, status: r?.status ?? null, caller: r?.caller ?? null, isGroup: true }
}

// Başlatır ya da süren aramaya katılır. Dönüş: { id, status }.
// Hatada err.code: 'ALREADY_IN_CALL' | 'CALL_FULL' | 'NOT_ALLOWED' | null.
export async function startGroupCall(threadId) {
  return arama(await cagir('start_group_call', { tid: threadId }))
}

// Süren aramaya katılır. status 'ended' ise arama bu arada bitmiş.
export async function joinGroupCall(callId) {
  return arama(await cagir('join_group_call', { cid: callId }))
}

// Ayrılır. reason: 'hangup' | 'cancel' | 'timeout' | 'lost'. Son katılımcı çıkınca arama biter.
export async function leaveGroupCall(callId, reason = 'hangup') {
  await cagir('leave_group_call', { cid: callId, reason })
}

// Canlılık (20 sn'de bir). true = sürüyor.
export async function pingGroupCall(callId) {
  return (await cagir('ping_group_call', { cid: callId })) === true
}

// "grup_arama" yükü -> { callId, threadId, status, caller, reason, count } ya da null (bozuk yük)
export function parseGroupCallEvent(payload) {
  const p = payload ?? {}
  if (!p.call_id || !p.thread_id || !['ringing', 'active', 'ended'].includes(p.status)) return null
  return {
    callId: p.call_id,
    threadId: p.thread_id,
    status: p.status,
    caller: p.caller ?? null,
    reason: p.reason ?? null,
    count: Number.isFinite(p.count) ? p.count : 0,
    // Aramadaki kişilerin id'leri (011 düzeltme turu 1); eski yükte yoksa null
    participants: Array.isArray(p.participants) ? p.participants.filter((x) => typeof x === 'string') : null,
  }
}

// Aramadaki (ayrılmamış) kişilerin id'leri (RLS: grubun üyeleri okur). Bağlantıları uzlaştırmak için:
// katılınca ve user: kanalı yeniden bağlanınca (kaçan olay olabilir).
export async function fetchCallParticipants(callId) {
  const { data, error } = await supabase.from('dm_call_members').select('user_id').eq('call_id', callId).is('left_at', null)
  if (error) throw new Error(error.message)
  return (data ?? []).map((r) => r.user_id)
}

// Gelen grup araması kartının başlığı: "Grup adı · berk arıyor"
export const grupAriyorMetni = (grupAd, arayan) => `${grupAd} · ${arayan} arıyor`
// "Aramaya katıl (3)"
export const aramayaKatilMetni = (sayi) => (sayi > 0 ? `Aramaya katıl (${sayi})` : 'Aramaya katıl')
