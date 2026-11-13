// Sunucuyu sessize alma: sessizdeki sunucunun @bahsetmeleri bildirim vermez (okunmamış rozeti yine görünür).
// Hesapta saklanır (server_mutes tablosu, yalnız kendi satırların; supabase/migrations/007_sosyal.sql),
// yani her cihazda geçerlidir.
import { supabase } from '../lib/supabase.js'

// Sessize aldığım sunucuların id'leri: Set<serverId>
export async function fetchMutedServers() {
  const { data, error } = await supabase.from('server_mutes').select('server_id')
  if (error) throw new Error(error.message)
  return new Set((data ?? []).map((r) => r.server_id))
}

// Sessize alır. Zaten sessizse bir şey olmaz. user_id veritabanında auth.uid() ile dolar.
export async function muteServer(serverId) {
  const { error } = await supabase.from('server_mutes').insert({ server_id: serverId })
  if (error && error.code !== '23505') throw new Error(error.message) // 23505: zaten sessizde
}

// Sessizden çıkarır (RLS yalnız kendi satırımı siler)
export async function unmuteServer(serverId) {
  const { error } = await supabase.from('server_mutes').delete().eq('server_id', serverId)
  if (error) throw new Error(error.message)
}
