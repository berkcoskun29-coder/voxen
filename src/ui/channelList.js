// Kanal paneli: sunucu adı, davet düğmesi, yazılı/sesli kanallar ve altta kullanıcı çubuğu.
// Sesli kanalların altında içerideki kişiler; sesli kanaldaysak altta ses paneli.
import { avatarWithDot } from './memberList.js'
import { renderVoicePanel } from './voicePanel.js'
import { voiceStateIcon, cameraIcon, screenIcon } from './icons.js'

// Kim hangi sesli kanalda? members: profil dizisi, voiceStates: Map<userId, {channelId, ...}>
// (voice_states tablosundan), presence: Map<userId, durum> (verilirse yalnız çevrimiçi olanlar gösterilir:
// kapanan pencereden kalmış eski satır kimseyi kanalda gibi göstermesin).
// Dönen: Map<kanalId, profil dizisi> (üye listesindeki sırayla)
export function voiceMembersByChannel(members, voiceStates, presence) {
  const gruplar = new Map()
  for (const kisi of members) {
    const kanalId = voiceStates.get(kisi.id)?.channelId
    if (!kanalId) continue
    if (presence && !presence.has(kisi.id)) continue
    if (!gruplar.has(kanalId)) gruplar.set(kanalId, [])
    gruplar.get(kanalId).push(kisi)
  }
  return gruplar
}

// Sesli kanaldaki bir kişi: küçük avatar (resim ya da baş harf) + ad.
// Konuşurken avatarın çevresinde yeşil halka (CSS: .voice-avatar.speaking)
// sesDurumu: o kişinin voice_states satırı { muted, deafened, camera, screen }
function sesliKisi(kisi, konusuyor, sesDurumu) {
  const satir = document.createElement('div')
  satir.className = 'voice-member'
  let av
  if (kisi.avatar_url) {
    av = document.createElement('img')
    av.src = kisi.avatar_url
    av.alt = ''
  } else {
    av = document.createElement('span')
    av.textContent = (Array.from(kisi.username)[0] ?? '?').toLocaleUpperCase('tr')
  }
  av.className = 'voice-avatar' + (konusuyor ? ' speaking' : '')
  av.dataset.userId = kisi.id
  av.style.background = kisi.color
  const ad = document.createElement('span')
  ad.className = 'voice-member-name'
  ad.textContent = kisi.username
  satir.append(av, ad)
  // Sağdaki küçük simgeler (herkes görür): susturma/sağırlık, kamera açık, ekran paylaşıyor
  const simgeler = document.createElement('span')
  simgeler.className = 'voice-member-icons'
  const simge = voiceStateIcon(sesDurumu?.muted, sesDurumu?.deafened)
  if (simge) simgeler.appendChild(simge)
  if (sesDurumu?.camera) {
    const k = cameraIcon()
    k.dataset.state = 'camera'
    simgeler.appendChild(k)
  }
  if (sesDurumu?.screen) {
    const e = screenIcon()
    e.dataset.state = 'screen'
    simgeler.appendChild(e)
  }
  if (simgeler.childElementCount) satir.appendChild(simgeler)
  return satir
}

// Paneli baştan çizmeden sadece konuşan halkalarını günceller (100 ms'de bir değişebilir)
export function updateSpeakingRings(panel, konusanlar) {
  for (const av of panel.querySelectorAll('.voice-avatar')) {
    av.classList.toggle('speaking', konusanlar.has(av.dataset.userId))
  }
}

// Bir kanal grubunu (başlık + kanallar) panele ekler.
// sesli: { members: Map<kanalId, profil[]>, speaking: Set<userId> } (sadece sesli grupta)
function grupEkle(panel, baslik, kanallar, secili, tur, handlers, sahip, sesli) { // sesli.voiceStates: Map<userId, durum>
  const baslikSatiri = document.createElement('div')
  baslikSatiri.className = 'section-head'
  const b = document.createElement('span')
  b.className = 'section-title'
  b.textContent = baslik
  baslikSatiri.appendChild(b)
  if (sahip) {
    const ekle = document.createElement('button')
    ekle.type = 'button'
    ekle.className = 'link-btn'
    ekle.textContent = '+ kanal'
    ekle.onclick = () => handlers.onAddChannel?.(tur)
    baslikSatiri.appendChild(ekle)
  }
  const grup = document.createElement('div')
  grup.className = 'channel-group'
  for (const k of kanallar) {
    const satir = document.createElement('button')
    satir.type = 'button'
    satir.className = 'channel-item' + (k.id === secili ? ' selected' : '')
    // Yazılı kanallar # ile başlar; sesli kanalın adında zaten simge olabilir
    satir.textContent = tur === 'text' ? `# ${k.name}` : k.name
    satir.onclick = () => handlers.onSelectChannel?.(k.id)
    grup.appendChild(satir)
    if (sesli) {
      // Bu sesli kanaldaki kişiler, kanalın hemen altında
      const kisiler = document.createElement('div')
      kisiler.className = 'voice-members'
      kisiler.dataset.voiceChannel = k.id
      for (const kisi of sesli.members.get(k.id) ?? []) kisiler.appendChild(sesliKisi(kisi, sesli.speaking.has(kisi.id), sesli.voiceStates?.get(kisi.id)))
      grup.appendChild(kisiler)
    }
  }
  panel.append(baslikSatiri, grup)
}

// Alttaki kullanıcı çubuğu: renkli baş harf (ya da resim), ad, ⚙ ve çıkış
function kullaniciCubugu(profile, handlers, myStatus, voiceState) {
  const bar = document.createElement('div')
  bar.className = 'user-bar'
  // Avatarın köşesinde kendi durum noktamız
  const av = avatarWithDot(profile, myStatus, 'user-avatar')
  const ad = document.createElement('span')
  ad.className = 'user-name'
  ad.textContent = profile.username
  const ayar = document.createElement('button')
  ayar.type = 'button'; ayar.className = 'icon-btn'; ayar.title = 'Ayarlar'; ayar.textContent = '⚙'
  ayar.onclick = () => handlers.onSettings?.()
  const mik = document.createElement('button')
  mik.type = 'button'; mik.className = 'icon-btn'; mik.title = 'Mikrofon testi'; mik.textContent = '🎤'
  mik.onclick = () => handlers.onMicTest?.()
  const cikis = document.createElement('button')
  cikis.type = 'button'; cikis.className = 'icon-btn'; cikis.title = 'Çıkış'; cikis.textContent = 'Çıkış'
  cikis.onclick = () => handlers.onSignOut?.()
  // Sesli kanaldaysak kendi susturma/sağırlaştırma simgemiz adın yanında
  const kendi = voiceState ? voiceStateIcon(voiceState.muted, voiceState.deafened) : null
  if (kendi) bar.append(av, ad, kendi, mik, ayar, cikis)
  else bar.append(av, ad, mik, ayar, cikis)
  return bar
}

// ctx: { server, channels, profile, selectedChannelId, handlers,
//        voiceMembers (Map<kanalId, profil[]>), speaking (Set<userId>), voiceStates (Map<userId, durum>),
//        voice (sesli kanaldaysak: { channelName, state, handlers } -> ses paneli) }
// handlers: onSelectChannel(id), onAddChannel(kind), onCopyInvite(), onSettings(), onMicTest(), onSignOut()
export function renderChannelList(panel, ctx) {
  const { server, channels, profile, selectedChannelId, handlers } = ctx
  panel.className = 'channel-panel'
  panel.innerHTML = ''
  const sahip = server ? server.owner_id === profile.id : false

  const ust = document.createElement('div')
  ust.className = 'panel-top'
  if (server) {
    const h = document.createElement('h2')
    h.textContent = server.name
    const davet = document.createElement('button')
    davet.type = 'button'
    davet.className = 'secondary invite-btn'
    davet.textContent = 'Davet linkini kopyala'
    davet.onclick = () => handlers.onCopyInvite?.()
    ust.append(h, davet)
  } else {
    const p = document.createElement('p')
    p.className = 'muted'
    p.textContent = 'Henüz bir sunucun yok. Soldaki + ile oluştur.'
    ust.appendChild(p)
  }
  panel.appendChild(ust)

  const liste = document.createElement('div')
  liste.className = 'channel-scroll'
  if (server) {
    const yazili = channels.filter((k) => k.kind === 'text')
    const sesli = channels.filter((k) => k.kind === 'voice')
    grupEkle(liste, 'Yazılı kanallar', yazili, selectedChannelId, 'text', handlers, sahip)
    grupEkle(liste, 'Sesli kanallar', sesli, selectedChannelId, 'voice', handlers, sahip, {
      members: ctx.voiceMembers ?? new Map(),
      speaking: ctx.speaking ?? new Set(),
      voiceStates: ctx.voiceStates,
    })
  }
  panel.appendChild(liste)
  if (ctx.voice) panel.appendChild(renderVoicePanel(ctx.voice))
  panel.appendChild(kullaniciCubugu(profile, handlers, ctx.myStatus ?? 'online', ctx.voice?.state))
}
