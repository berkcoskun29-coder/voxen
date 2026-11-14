// Bildirim ayarları (v0.13.0): sunucu ve kanal bildirim düzeyi, kanalı (süreli) sessize alma, "Tümünü okundu say".
// Hesapta saklanır (supabase/migrations/015_bildirimler.sql; yalnız kendi satırların), yani her cihazda geçerlidir.
// Kurallar (etkin düzey, süre dolumu) src/bildirimDuzeyi.js'te.
// Bire bir DM'i sessize alma 011'deki dm_mutes ile (src/data/groups.js muteDm/unmuteDm); burada yalnız okunur.
import { supabase } from '../lib/supabase.js'
import { DUZEYLER, VARSAYILAN_DUZEY } from '../bildirimDuzeyi.js'

const HATALAR = { NOT_ALLOWED: 'Bu sunucuda bunu yapamazsın.' }
const hata = (e) => new Error(HATALAR[e?.message] ?? e?.message ?? 'İşlem yapılamadı.')

// Dönen: { sunucular: Map<serverId, düzey>, kanallar: Map<kanalId, { level, muted, mutedUntil }> }
export async function fetchNotifyPrefs() {
  const [s, k] = await Promise.all([
    supabase.from('server_notify_levels').select('server_id, level'),
    supabase.from('channel_notify_prefs').select('channel_id, level, muted, muted_until'),
  ])
  if (s.error) throw new Error(s.error.message)
  if (k.error) throw new Error(k.error.message)
  return {
    sunucular: new Map((s.data ?? []).map((r) => [r.server_id, r.level])),
    kanallar: new Map((k.data ?? []).map((r) => [r.channel_id, { level: r.level ?? null, muted: !!r.muted, mutedUntil: r.muted_until ?? null }])),
  }
}

// Sunucunun düzeyi. Varsayılana (Yalnız @bahsetmeler) dönünce satır silinir. user_id veritabanında auth.uid().
export async function setServerNotifyLevel(serverId, level) {
  if (!DUZEYLER.includes(level)) throw new Error('Geçersiz bildirim düzeyi')
  const q = level === VARSAYILAN_DUZEY
    ? supabase.from('server_notify_levels').delete().eq('server_id', serverId)
    : supabase.from('server_notify_levels').upsert({ server_id: serverId, level }, { onConflict: 'user_id,server_id' })
  const { error } = await q
  if (error) throw new Error(error.message)
}

// Kanalın ayarı: { level (null = sunucu varsayılanı), muted, mutedUntil (null = ben açana kadar) }.
// Hem varsayılan düzeyde hem sessiz değilse satır silinir.
export async function setChannelNotifyPrefs(channelId, { level = null, muted = false, mutedUntil = null } = {}) {
  if (level != null && !DUZEYLER.includes(level)) throw new Error('Geçersiz bildirim düzeyi')
  const q = level == null && !muted
    ? supabase.from('channel_notify_prefs').delete().eq('channel_id', channelId)
    : supabase.from('channel_notify_prefs').upsert(
      { channel_id: channelId, level, muted: !!muted, muted_until: muted ? mutedUntil : null },
      { onConflict: 'user_id,channel_id' },
    )
  const { error } = await q
  if (error) throw new Error(error.message)
}

// "Tümünü okundu say": sunucudaki bütün yazılı kanallar okundu
export async function markServerRead(serverId) {
  const { error } = await supabase.rpc('mark_server_read', { sid: serverId })
  if (error) throw hata(error)
}

// Sessize aldığım konuşmalar (bire bir ve grup): Set<threadId>
export async function fetchMutedDms() {
  const { data, error } = await supabase.from('dm_mutes').select('thread_id')
  if (error) throw new Error(error.message)
  return new Set((data ?? []).map((r) => r.thread_id))
}
