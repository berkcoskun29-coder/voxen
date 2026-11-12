// Sunucu işlemleri: Supabase ile konuşan yer.
import { supabase } from '../lib/supabase.js'
import { PUBLIC_URL } from '../config.js'
import { isTauri } from '../desktop.js'

// Sunucu kurar (veritabanı #genel ve Lobi kanallarını da açar); yeni sunucunun id'sini döner.
export async function createServer(name) {
  const { data, error } = await supabase.rpc('create_server', { name })
  if (error) throw new Error(error.message)
  return data
}

// Üyesi olduğum sunucular (güvenlik kuralı zaten sadece üyesi olduklarımı verir).
export async function listMyServers() {
  const { data, error } = await supabase.from('servers').select('*').order('created_at')
  if (error) throw new Error(error.message)
  return data ?? []
}

// Davet koduyla katılır; sunucu id'sini döner. Kod yanlışsa hata fırlatır.
export async function joinByInvite(code) {
  const { data, error } = await supabase.rpc('join_server_by_invite', { code })
  if (error) throw new Error(error.message)
  return data
}

// Sunucudan ayrılır. Sahip ayrılamaz: veritabanı şu hatayı verir (metni olduğu gibi fırlatılır):
// "Sahibi olduğun sunucudan ayrılamazsın; istersen sunucuyu silebilirsin."
export async function leaveServer(serverId) {
  const { error } = await supabase.rpc('leave_server', { sid: serverId })
  if (error) throw new Error(error.message)
}

// Sunucuyu siler (yalnız sahip). Kanallar, mesajlar ve üyelikler de silinir.
export async function deleteServer(serverId) {
  const { error } = await supabase.rpc('delete_server', { sid: serverId })
  if (error) throw new Error(error.message)
}

// Sunucu adını değiştirir (yalnız sahip, 1–40 karakter). Boşluklar kırpılır.
export async function renameServer(serverId, name) {
  const { error } = await supabase.rpc('rename_server', { sid: serverId, ad: String(name ?? '').trim() })
  if (error) throw new Error(error.message)
}

// Paylaşılacak davet adresi. Masaüstü programında location.origin "http://tauri.localhost" olur
// (başkası açamaz); bu yüzden .env'deki VITE_PUBLIC_URL (web sürümünün adresi) kullanılır.
// Masaüstündeyiz ve adres verilmemişse null döner (link kurulamaz).
export function getInviteLink(server, { publicUrl = PUBLIC_URL, desktop = isTauri() } = {}) {
  const taban = (publicUrl ?? '').replace(/\/+$/, '') || (desktop ? '' : location.origin)
  return taban ? `${taban}/#/davet/${server.invite_code}` : null
}

// Panoya ne kopyalanacak? Link kurulabiliyorsa link, kurulamıyorsa sadece kod.
// Dönen: { text, message } (message: kopyalanınca gösterilecek bildirim)
export function inviteToCopy(server, secenekler) {
  const link = getInviteLink(server, secenekler)
  if (link) return { text: link, message: 'Davet linki kopyalandı' }
  return { text: server.invite_code, message: 'Davet kodu kopyalandı' }
}
