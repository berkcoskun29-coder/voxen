// Sunucu üyeleri: üyelik satırları + profilleri.
import { supabase } from '../lib/supabase.js'
import { fetchProfiles } from './messages.js'

// Sunucunun üyelerinin profilleri (kullanıcı adına göre sıralı).
// Üyelik auth.users'a bağlı olduğundan profiller ayrı sorguyla alınır.
export async function listMembers(serverId) {
  const { data, error } = await supabase.from('server_members').select('user_id').eq('server_id', serverId)
  if (error) throw new Error(error.message)
  const profiller = await fetchProfiles((data ?? []).map((m) => m.user_id))
  return profiller.sort((a, b) => a.username.localeCompare(b.username, 'tr'))
}
