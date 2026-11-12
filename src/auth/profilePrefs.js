// "Rahatsız etmeyin" ve durum yazısı şimdilik tarayıcıda (localStorage) saklanır.
// Görev 5'te bunlar canlı varlık (presence) sistemine bağlanacak.
const KEY = 'voxen.presence'

export function getLocalPresencePrefs() {
  try {
    const kayit = JSON.parse(localStorage.getItem(KEY))
    return {
      dnd: Boolean(kayit?.dnd),
      statusText: String(kayit?.statusText ?? '').slice(0, 60),
    }
  } catch {
    return { dnd: false, statusText: '' } // kayıt yok ya da bozuk
  }
}

// Sadece verilen alanları değiştirir: setLocalPresencePrefs({ dnd: true })
export function setLocalPresencePrefs(partial) {
  const yeni = { ...getLocalPresencePrefs(), ...partial }
  yeni.dnd = Boolean(yeni.dnd)
  yeni.statusText = String(yeni.statusText).slice(0, 60)
  try { localStorage.setItem(KEY, JSON.stringify(yeni)) } catch { /* depolama kapalıysa sessizce geç */ }
  return yeni
}
