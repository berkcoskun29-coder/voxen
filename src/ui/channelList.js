// Kanal paneli: sunucu adı, davet düğmesi, yazılı/sesli kanallar ve altta kullanıcı çubuğu.
// Sesli kanalların altında içerideki kişiler; sesli kanaldaysak altta ses paneli.
import { avatarWithDot } from './memberList.js'
import { sayiYazisi } from './unread.js'
import { avatarTextColor } from './avatarColor.js'
import { makeProfileOpener } from './profileOpener.js'
import { STATUS_LABELS } from './profileCard.js'
import { renderVoicePanel, renderMuteButtons, renderCallRow } from './voicePanel.js'
import { voiceStateIcon, cameraIcon, screenIcon, gearIcon, speakerIcon } from './icons.js'

// "Kanal ekle" penceresinde tür seçimi: açılır liste yerine iki seçim kartı (Yazılı / Sesli).
// Ekran okuyucu için radyo grubu: role="radiogroup" + role="radio" + aria-checked.
// Klavye: Tab ile yalnız seçili karta gelinir; ok tuşları seçimi değiştirir (roving tabindex).
const KANAL_TURLERI = [
  { tur: 'text', ad: 'Yazılı', aciklama: 'Mesaj, link ve sohbet' },
  { tur: 'voice', ad: 'Sesli', aciklama: 'Konuşma, kamera, ekran paylaşımı' },
]
let turGrupSayac = 0 // grup başlığı id'si benzersiz olsun (aria-labelledby için)

// Türün küçük simgesi: yazılıda "#", seslide hoparlör
export function kanalTuruSimgesi(tur) {
  if (tur === 'voice') return speakerIcon(18)
  return document.createTextNode('#')
}

// baslangic: 'text' | 'voice' (hangi bölümün "+ kanal"ından açıldıysa); onDegisim(tur) seçim değişince
// Döner: { baslik, kutu, secili() } — baslik ("Tür") ve kutu pencereye bu sırayla konur
export function renderKindPicker(baslangic = 'text', onDegisim) {
  let secili = baslangic === 'voice' ? 'voice' : 'text'
  const baslik = document.createElement('span')
  baslik.className = 'group-label'
  baslik.id = `kanal-turu-${++turGrupSayac}`
  baslik.textContent = 'Tür'
  const kutu = document.createElement('div')
  kutu.className = 'kind-cards'
  kutu.setAttribute('role', 'radiogroup')
  kutu.setAttribute('aria-labelledby', baslik.id)

  const kartlar = KANAL_TURLERI.map(({ tur, ad, aciklama }) => {
    const kart = document.createElement('button')
    kart.type = 'button'
    kart.className = 'kind-card'
    kart.setAttribute('role', 'radio')
    kart.dataset.tur = tur
    const simge = document.createElement('span')
    simge.className = 'kind-icon'
    simge.setAttribute('aria-hidden', 'true')
    simge.appendChild(kanalTuruSimgesi(tur))
    const yazi = document.createElement('span')
    const isim = document.createElement('span')
    isim.className = 'kind-name'
    isim.textContent = ad
    const alt = document.createElement('small')
    alt.textContent = aciklama
    yazi.append(isim, alt)
    kart.append(simge, yazi)
    kart.onclick = () => sec(tur)
    kutu.appendChild(kart)
    return kart
  })

  // Seçimi uygular: aria-checked ve Tab sırası yalnız seçili kartta
  function isaretle() {
    for (const k of kartlar) {
      const bu = k.dataset.tur === secili
      k.setAttribute('aria-checked', String(bu))
      k.tabIndex = bu ? 0 : -1
    }
  }
  function sec(tur, odakla = false) {
    secili = tur
    isaretle()
    if (odakla) kartlar.find((k) => k.dataset.tur === tur).focus()
    onDegisim?.(tur)
  }
  // Ok tuşları: bir sonraki/önceki karta geç (sondan başa döner)
  kutu.addEventListener('keydown', (e) => {
    const yon = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[e.key]
    if (!yon) return
    e.preventDefault()
    const sira = KANAL_TURLERI.findIndex((t) => t.tur === secili)
    const yeni = KANAL_TURLERI[(sira + yon + KANAL_TURLERI.length) % KANAL_TURLERI.length].tur
    sec(yeni, true)
  })
  isaretle()
  return { baslik, kutu, secili: () => secili }
}

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
  av.style.color = avatarTextColor(kisi.color)
  makeProfileOpener(av, kisi, `profil-ses-${kisi.id}`) // tıklayınca profil kartı (app.js)
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
function grupEkle(panel, baslik, kanallar, secili, tur, handlers, sahip, sesli, unread = null) { // sesli.voiceStates: Map<userId, durum>
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
    ekle.dataset.odak = `kanal-ekle-${tur}` // yeniden çizimde odağı bulmak için (bkz. renderChannelList)
    ekle.onclick = () => handlers.onAddChannel?.(tur)
    baslikSatiri.appendChild(ekle)
  }
  const grup = document.createElement('div')
  grup.className = 'channel-group'
  for (const k of kanallar) {
    // Satır: kanal düğmesi + (yalnız sahipte) ⚙ düğmesi. İç içe düğme olmasın diye ikisi kardeş.
    const sarma = document.createElement('div')
    sarma.className = 'channel-row'
    const satir = document.createElement('button')
    satir.type = 'button'
    // Okunmamış yalnız yazılı kanalda (sesli kanalda sayaç yok)
    const okunmamis = tur === 'text' ? (unread?.count?.(k.id) ?? 0) : 0
    satir.className = 'channel-item' + (k.id === secili ? ' selected' : '') + (okunmamis > 0 ? ' unread' : '')
    // Yazılı kanallar # ile başlar; sesli kanalın adında zaten simge olabilir
    satir.textContent = tur === 'text' ? `# ${k.name}` : k.name
    if (okunmamis > 0) {
      const say = document.createElement('span')
      say.className = 'unread-count'
      say.textContent = sayiYazisi(okunmamis)
      // Seni anan okunmamış mesaj varsa sayının önünde küçük "@" işareti
      const anma = unread?.mentions?.(k.id) ?? 0
      if (anma > 0) {
        const isaret = document.createElement('span')
        isaret.className = 'mention-mark'
        isaret.setAttribute('aria-hidden', 'true') // bilgi aria-label'da
        isaret.textContent = '@'
        say.prepend(isaret)
      }
      satir.appendChild(say)
      satir.setAttribute('aria-label', `${k.name}, ${sayiYazisi(okunmamis)} okunmamış mesaj` + (anma > 0 ? `, ${sayiYazisi(anma)} bahsetme` : ''))
    }
    satir.dataset.odak = `kanal-${k.id}`
    satir.onclick = () => handlers.onSelectChannel?.(k.id)
    sarma.appendChild(satir)
    if (sahip) {
      const disli = document.createElement('button')
      disli.type = 'button'
      disli.className = 'channel-gear'
      disli.dataset.odak = `kanal-ayar-${k.id}`
      disli.setAttribute('aria-label', `${k.name} kanal ayarları`)
      disli.setAttribute('aria-haspopup', 'menu')
      disli.setAttribute('aria-expanded', 'false')
      disli.appendChild(gearIcon(14))
      disli.onclick = () => handlers.onChannelMenu?.(k, disli)
      sarma.appendChild(disli)
    }
    grup.appendChild(sarma)
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

// Alttaki kullanıcı çubuğu: renkli baş harf (ya da resim), ad, Sustur, Sağırlaştır ve Ayarlar simgeleri.
// sesDurumu: { muted, deafened, listenOnly } — sesli kanaldaysak oturumun durumu, değilsek kayıtlı tercih
// (katılınca uygulanır). Mikrofon testi Ayarlar > Cihazlar'da; Çıkış yap Ayarlar > Hesap'ta.
function kullaniciCubugu(profile, handlers, myStatus, sesDurumu, myStatusText = '') {
  const bar = document.createElement('div')
  bar.className = 'user-bar'
  // Avatarın köşesinde kendi durum noktamız
  // Avatara ya da isme tıklayınca kendi kartımız açılır (app.js); dişli yine Ayarlar'ı açar
  const av = makeProfileOpener(avatarWithDot(profile, myStatus, 'user-avatar'), profile, 'profil-kendi-avatar')
  const bilgi = document.createElement('div')
  bilgi.className = 'user-info'
  makeProfileOpener(bilgi, profile, 'profil-kendi-ad', { tabsiz: true }) // Tab durağı avatar; ad fareyle
  bilgi.title = profile.username // sığmazsa "…" ile kısalır, tam ad burada
  const ad = document.createElement('span')
  ad.className = 'user-name'
  ad.textContent = profile.username
  // İkinci satır: durum yazısı varsa o, yoksa durum adı
  const alt = document.createElement('span')
  alt.className = 'user-sub'
  alt.textContent = myStatusText || (STATUS_LABELS[myStatus] ?? STATUS_LABELS.online)
  bilgi.append(ad, alt)
  const ayar = document.createElement('button')
  ayar.type = 'button'; ayar.className = 'icon-btn'; ayar.title = 'Ayarlar'; ayar.dataset.tip = 'Ayarlar'; ayar.setAttribute('aria-label', 'Ayarlar'); ayar.dataset.odak = 'ayarlar'; ayar.appendChild(gearIcon())
  ayar.onclick = () => handlers.onSettings?.()
  const [sustur, sagir] = renderMuteButtons(sesDurumu, handlers)
  bar.append(av, bilgi, sustur, sagir, ayar)
  return bar
}

// Odak anahtarı (data-odak) verilen öğeyi bulur; anahtarda tırnak olsa da seçici bozulmasın diye
// CSS seçicisi yerine tek tek karşılaştırırız. Yoksa null.
function odakAnahtariylaBul(kok, anahtar) {
  if (!anahtar) return null
  return [...kok.querySelectorAll('[data-odak]')].find((e) => e.dataset.odak === anahtar) ?? null
}

// ctx: { server, channels, profile, selectedChannelId, handlers,
//        voiceMembers (Map<kanalId, profil[]>), speaking (Set<userId>), voiceStates (Map<userId, durum>),
//        unread ({ count(kanalId), mentions(kanalId) }, isteğe bağlı: okunmamış ve bahsetme sayaçları),
//        voice (sesli kanaldaysak: { channelName, state, handlers } -> ses paneli) }
//        audio (sesli kanalda değilken çubuktaki Sustur/Sağırlaştır tercihi: { muted, deafened }),
//        home (Ana sayfadayken, server yokken: kanal listesinin yerine konan öğe; bkz. home.js) }
// handlers: onSelectChannel(id), onAddChannel(kind), onServerMenu(düğme), onChannelMenu(kanal, düğme), onCopyInvite(), onSettings(), onToggleMute(), onToggleDeafen()
export function renderChannelList(panel, ctx) {
  const { server, channels, profile, selectedChannelId, handlers } = ctx
  panel.className = 'channel-panel'
  // Panel baştan çizilince odaktaki düğme silinir ve klavye odağı kaybolurdu. Önce odaktaki
  // düğmenin anahtarını (data-odak) hatırla, çizimden sonra aynı anahtarlı yeni düğmeye odaklan.
  const odakli = document.activeElement
  const odakAnahtari = panel.contains(odakli) ? odakli.dataset?.odak : null
  panel.innerHTML = ''
  const sahip = server ? server.owner_id === profile.id : false

  const ust = document.createElement('div')
  ust.className = 'panel-top'
  if (server) {
    const h = document.createElement('h2')
    // Sunucu adı bir düğme: tıklayınca sunucu menüsü açılır (ok simgesi CSS'ten gelir)
    const adDugmesi = document.createElement('button')
    adDugmesi.type = 'button'
    adDugmesi.className = 'server-name-btn'
    adDugmesi.textContent = server.name
    adDugmesi.dataset.odak = 'sunucu-menu'
    adDugmesi.setAttribute('aria-haspopup', 'menu')
    adDugmesi.setAttribute('aria-expanded', 'false')
    adDugmesi.onclick = () => handlers.onServerMenu?.(adDugmesi)
    h.appendChild(adDugmesi)
    const davet = document.createElement('button')
    davet.type = 'button'
    davet.className = 'secondary invite-btn'
    davet.textContent = 'Davet et' // fiil: tıklayınca davet linki panoya kopyalanır
    davet.dataset.odak = 'davet'
    davet.onclick = () => handlers.onCopyInvite?.()
    ust.append(h, davet)
    panel.appendChild(ust)
  }
  // Sunucu yoksa üst kısım boş kalır: aynı şeyi ana alandaki karşılama kartı zaten söylüyor

  const liste = document.createElement('div')
  liste.className = 'channel-scroll'
  if (server) {
    const yazili = channels.filter((k) => k.kind === 'text')
    const sesli = channels.filter((k) => k.kind === 'voice')
    grupEkle(liste, 'Yazılı kanallar', yazili, selectedChannelId, 'text', handlers, sahip, undefined, ctx.unread)
    grupEkle(liste, 'Sesli kanallar', sesli, selectedChannelId, 'voice', handlers, sahip, {
      members: ctx.voiceMembers ?? new Map(),
      speaking: ctx.speaking ?? new Set(),
      voiceStates: ctx.voiceStates,
    })
  } else if (ctx.home) {
    // Ana sayfada kanal listesinin yerinde Arkadaşlar satırı ve DM listesi (home.js); çubuk aynen kalır
    liste.appendChild(ctx.home)
  }
  panel.appendChild(liste)
  if (ctx.voice) panel.appendChild(renderVoicePanel(ctx.voice))
  else if (ctx.call) panel.appendChild(renderCallRow(ctx.call)) // DM aramasındayız: "Aramada · Ad"
  // Çubuktaki Sustur/Sağırlaştır: sesli kanaldaysak oturumun durumu (tek durum), değilsek tercih
  const sesDurumu = ctx.voice?.state ?? ctx.audio ?? { muted: false, deafened: false }
  panel.appendChild(kullaniciCubugu(profile, handlers, ctx.myStatus ?? 'online', sesDurumu, ctx.myStatusText ?? ''))
  odakAnahtariylaBul(panel, odakAnahtari)?.focus()
}
