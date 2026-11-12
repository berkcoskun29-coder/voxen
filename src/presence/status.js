// Çevrimiçi durumunun saf (ağsız) mantığı: renkler, hesaplama, birleştirme.

export const STATUS_COLORS = {
  online: '#3be37a',
  idle: '#e0a33b',
  dnd: '#e05b5b',
  offline: '#6b7280',
}

export const STATUS_TEXT_MAX = 60
export const IDLE_AFTER_MS = 10 * 60 * 1000 // 10 dakika işlem yoksa "boşta"

// Durum yazısını 60 karakterle sınırlar (Türkçe/emoji karakterleri bölmesin diye Array.from).
export function clampStatusText(text) {
  return Array.from(String(text ?? '')).slice(0, STATUS_TEXT_MAX).join('')
}

// Kişinin durumunu hesaplar.
// manual === 'dnd' ise her zaman 'dnd'; 10 dakikadan uzun süredir işlem yoksa 'idle'; yoksa 'online'.
export function computeStatus({ lastActivityMs, nowMs, manual }) {
  if (manual === 'dnd') return 'dnd'
  if (nowMs - lastActivityMs > IDLE_AFTER_MS) return 'idle'
  return 'online'
}

// Aynı kişi birden çok sekmede açıksa Supabase bir DİZİ verir; hepsini tek duruma indirir.
// Kural: biri dnd ise dnd; yoksa biri online ise online; yoksa idle.
export function mergeEntries(entries) {
  const liste = entries ?? []
  if (liste.length === 0) return null
  const sira = ['dnd', 'online', 'idle']
  const status = sira.find((s) => liste.some((e) => e.status === s)) ?? 'idle'
  const secilen = liste.find((e) => e.status === status) ?? liste[0]
  const voiceChannelId = liste.map((e) => e.voiceChannelId).find((v) => v != null) ?? null
  // Susturma/sağırlaştırma: çok sekmede, sesli kanala gerçekten bağlı olan (kanalı eşleşen) girdiden alınır
  const sesGirdisi = liste.find((e) => voiceChannelId != null && e.voiceChannelId === voiceChannelId)
  return {
    status,
    statusText: clampStatusText(secilen.statusText),
    voiceChannelId,
    voiceMuted: !!sesGirdisi?.voiceMuted,
    voiceDeafened: !!sesGirdisi?.voiceDeafened,
  }
}

// presenceState() { userId: [girdiler] } → Map<userId, {status, statusText, voiceChannelId}>
// Haritada olmayan kişi çevrimdışıdır.
export function buildPresenceMap(presenceState) {
  const harita = new Map()
  for (const [userId, entries] of Object.entries(presenceState ?? {})) {
    const birlesik = mergeEntries(entries)
    if (birlesik) harita.set(userId, birlesik)
  }
  return harita
}
