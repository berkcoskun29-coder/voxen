// Kanal işlemleri.
import { supabase } from '../lib/supabase.js'

// Sunucunun kanalları, position sırasına göre.
export async function listChannels(serverId) {
  const { data, error } = await supabase
    .from('channels').select('*').eq('server_id', serverId).order('position')
  if (error) throw new Error(error.message)
  return data ?? []
}

// Yeni kanal ekler (sadece sunucu sahibi yapabilir; kural veritabanında).
// kind: 'text' ya da 'voice'. Yeni kanal listenin sonuna gelir.
export async function createChannel(serverId, name, kind, position = 0) {
  const { error } = await supabase
    .from('channels').insert({ server_id: serverId, name, kind, position })
  if (error) throw new Error(error.message)
}
