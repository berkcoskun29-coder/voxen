// Tepki ve sabitleme için ortak değerler (supabase/migrations/009_tepki_yanit_sabit.sql).
// Emoji listesi veritabanındaki tepki_gecerli() ile AYNI olmalı (tests/schema009.test.js denetler):
// sunucu yalnız bu 8 emojiyi kabul eder. ❤️ iki kod noktasıdır (U+2764 U+FE0F).
import { rpcHatasi } from './friends.js'

export const EMOJILER = ['👍', '👎', '😂', '❤️', '😮', '😢', '🔥', '🎉']

// Konuşma (kanal ya da DM) başına en fazla sabit mesaj
export const SABIT_SINIRI = 50
export const SABIT_SINIRI_METNI = 'En fazla 50 mesaj sabitlenebilir.'

// Tepki/sabitleme RPC hatası -> Türkçe metinli Error (err.code: tanınan kod).
// Engel kodları (BLOCKED_DM, NOT_ALLOWED) aynı metne çevrilir: engellenen kişi bir şey öğrenmez.
const ETKILESIM_METINLERI = {
  NOT_ALLOWED: 'Bunu yapamazsın.',
  BLOCKED_DM: 'Bunu yapamazsın.',
  PIN_LIMIT: SABIT_SINIRI_METNI,
}
export function etkilesimHatasi(error) {
  return rpcHatasi(error, ETKILESIM_METINLERI)
}

// Mesaj sorgusuna gömülen tepki listesini düzene sokar: [{ emoji, user_id }] (geçersizler atılır).
// Alan yoksa (eski sorgu, canlı satır) null döner: "bilgi yok", boş liste değil.
export function gomuluTepkiler(satir) {
  const ham = satir?.reactions
  if (!Array.isArray(ham)) return null
  return ham.filter((r) => r && EMOJILER.includes(r.emoji) && r.user_id)
}

// Mesaj sorgusuna gömülen sabit bilgisi: { pinned_at, pinned_by } | null (sabit değil) | undefined (bilgi yok).
// PostgREST birebir ilişkide nesne döner; eski sürümler dizi dönebilir, ikisi de kabul edilir.
export function gomuluSabit(satir) {
  if (!satir || !('pin' in satir)) return undefined
  const p = Array.isArray(satir.pin) ? satir.pin[0] : satir.pin
  return p ?? null
}
