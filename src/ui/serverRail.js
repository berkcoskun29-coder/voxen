// Soldaki sunucu şeridi: her sunucu için ilk harfli simge ve en altta "+".

// Sunucu adının ilk harfi, büyük (Türkçe kurallarıyla: i -> İ)
export function ilkHarf(ad) {
  return (Array.from(ad.trim())[0] ?? '?').toLocaleUpperCase('tr')
}

// handlers: { onSelect(serverId), onAdd(), onJoin() }
export function renderRail(rail, servers, selectedId, handlers) {
  rail.innerHTML = ''
  for (const s of servers) {
    const dugme = document.createElement('button')
    dugme.type = 'button'
    dugme.className = 'server-icon' + (s.id === selectedId ? ' selected' : '')
    dugme.title = s.name
    dugme.textContent = ilkHarf(s.name)
    dugme.onclick = () => handlers.onSelect?.(s.id)
    rail.appendChild(dugme)
  }
  const ekle = document.createElement('button')
  ekle.type = 'button'
  ekle.className = 'server-icon add'
  ekle.title = 'Sunucu oluştur'
  ekle.textContent = '+'
  ekle.onclick = () => handlers.onAdd?.()
  rail.appendChild(ekle)
  const katil = document.createElement('button')
  katil.type = 'button'
  katil.className = 'server-icon join'
  katil.title = 'Sunucuya katıl'
  katil.textContent = '🔗'
  katil.onclick = () => handlers.onJoin?.()
  rail.appendChild(katil)
}
