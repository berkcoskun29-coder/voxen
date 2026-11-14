// Roller ve izinler (v0.11.0): Supabase ile konuşan yer. Kurallar veritabanında
// (supabase/migrations/013_roller.sql, has_permission); saf hesaplar src/data/rolKurallari.js'te.
// Rolleri ve atamaları o sunucunun üyeleri okur; yazma yalnız RPC ile.
import { supabase } from '../lib/supabase.js'
import { rpcHatasi } from './friends.js'

// Rol hata kodlarının Türkçesi
export const ROL_HATALARI = {
  NOT_ALLOWED: 'Bunu yapmaya yetkin yok.',
  ROLE_HIERARCHY: 'Bu rol (ya da kişi) senin en yüksek rolünden aşağıda değil.',
  PERMISSION_NOT_HELD: 'Kendinde olmayan bir izni veremezsin.',
  DEFAULT_ROLE: '@herkes rolü silinemez, taşınamaz ve atanamaz.',
  ROLE_LIMIT: 'Bir sunucuda en fazla 50 rol olabilir.',
  ROLE_NAME: 'Rol adı 1–30 karakter olmalı.',
  ROLE_COLOR: 'Geçersiz seçim. Sayfayı yenileyip tekrar dene.',
  BAD_PERMISSION: 'Geçersiz seçim. Sayfayı yenileyip tekrar dene.',
}

async function cagir(ad, argumanlar) {
  const { data, error } = await supabase.rpc(ad, argumanlar)
  if (error) throw rpcHatasi(error, ROL_HATALARI)
  return data
}

// Sunucunun rolleri (@herkes dahil). Hata olursa fırlatır.
export async function listRoles(serverId) {
  const { data, error } = await supabase
    .from('roles').select('id, server_id, name, color, position, permissions, is_default, hoist')
    .eq('server_id', serverId).order('position', { ascending: false })
  if (error) throw new Error(error.message)
  return (data ?? []).map((r) => ({ ...r, permissions: Array.isArray(r.permissions) ? r.permissions : [] }))
}

// Sunucudaki rol atamaları: [{ user_id, role_id }]
export async function listMemberRoles(serverId) {
  const { data, error } = await supabase.from('member_roles').select('user_id, role_id').eq('server_id', serverId)
  if (error) throw new Error(error.message)
  return data ?? []
}

// Rolleri ve atamaları birlikte yükler: { roles, memberRoles }
export async function loadServerRoles(serverId) {
  const [roles, memberRoles] = await Promise.all([listRoles(serverId), listMemberRoles(serverId)])
  return { roles, memberRoles }
}

// Yeni rol (en alta, @herkes'in hemen üstüne); id'sini döner
export function createRole(serverId, { name, color = null, permissions = [] } = {}) {
  return cagir('create_role', { sid: serverId, ad: String(name ?? '').trim(), renk: color, izinler: permissions })
}

// Rolü düzenler. @herkes'te yalnız izinler değişir (veritabanı adı/rengi yok sayar).
export function updateRole(roleId, { name, color = null, permissions = [], hoist = false } = {}) {
  return cagir('update_role', { rid: roleId, ad: String(name ?? '').trim(), renk: color, izinler: permissions, ayri: !!hoist })
}

export function deleteRole(roleId) {
  return cagir('delete_role', { rid: roleId })
}

// Rolü hedef sıraya taşır (1 = @herkes'in hemen üstü)
export function moveRole(roleId, hedef) {
  return cagir('move_role', { rid: roleId, hedef })
}

// Üyeye rol verir (ver = true) ya da alır
export function setMemberRole(serverId, userId, roleId, ver) {
  return cagir('set_member_role', { sid: serverId, uid: userId, rid: roleId, ver: !!ver })
}

// Üyeyi sunucudan çıkarır
export function kickMember(serverId, userId) {
  return cagir('kick_member', { sid: serverId, uid: userId })
}

// Davet kodunu yeniler; yeni kodu döner
export function regenerateInvite(serverId) {
  return cagir('regenerate_invite', { sid: serverId })
}

// Kanalı aynı türdeki komşusuyla yer değiştirir (yon: -1 yukarı, +1 aşağı)
export function moveChannel(channelId, yon) {
  return cagir('move_channel', { cid: channelId, yon })
}

// Bu kişinin o sunucuda şu izni var mı? (@herkes bildirimi için; hata olursa false)
export async function hasPermission(serverId, userId, perm) {
  try {
    const { data, error } = await supabase.rpc('has_permission', { sid: serverId, uid: userId, perm })
    return !error && data === true
  } catch { return false }
}
