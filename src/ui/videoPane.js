// Görüntü bölmesi: sesli kanaldayken sohbetin üstünde açılıp kapanan "Görüntü" alanı.
//   - Ekran paylaşımları büyük (üstte, "sahne"), kameralar küçük (altta, "şerit").
//   - Kutucuğa tıkla -> o büyür (odak); tekrar tıkla -> eski düzen. Çift tıkla -> tam ekran (tekrar: çık).
//   - Konuşanın kutucuğunda yeşil çerçeve.
//   - Kutucuk ancak sesli durum (voice_states) "açık" diyorsa VE iz gerçekten akıyorsa (muted değilse) görünür;
//     iz 'mute' olunca gizlenir, böylece donmuş son kare kalmaz.
//   - Her paylaşan için ses kaydırıcısı ve "Görüntüyü gizle" düğmesi (gizle = ekran sesi de 0).
//   - Görüntü alamayan eski sürüm için not satırı.
// Videolar hep sessiz (muted): ses gizli <audio> elemanlarından çalar (bkz. voice/session.js).

export const OLD_VERSION_NOTE = 'Görüntüyü görmesi için güncellemesi gerekiyor'
export const VIDEO_PANE_KEY = 'voxen.videoPaneCollapsed' // bölme kapalı mı (tarayıcıda hatırlanır)

// Uygulamadaki verilerden bölmenin istediği eş listesini kurar.
// self: kendi profilimiz, members: kanaldaki profiller, voiceStates: Map<userId, {camera, screen}>, session: sesli oturum
// Dönen her öğe: { id, name, self, camera, screen, tracks: {camera, screen}, speaking,
//                  videoCap (true/false/null=bilinmiyor), hidden, volume }
export function buildVideoPeers({ self, members, voiceStates, session }) {
  const st = session.getState()
  const konusanlar = st.speaking ?? new Set()
  const liste = [{
    id: self.id,
    name: self.username,
    self: true,
    camera: !!st.camera,
    screen: !!st.screen,
    tracks: session.getLocalTracks(),
    speaking: konusanlar.has(self.id),
    videoCap: true,
    hidden: false,
    volume: 1,
  }]
  for (const m of members) {
    if (m.id === self.id) continue
    const v = voiceStates.get(m.id) ?? {}
    const ayar = session.getScreenAudio(m.id)
    liste.push({
      id: m.id,
      name: m.username,
      self: false,
      camera: !!v.camera,
      screen: !!v.screen,
      tracks: session.getRemoteTracks(m.id),
      speaking: konusanlar.has(m.id),
      videoCap: session.peerHasVideo(m.id),
      hidden: ayar.hidden,
      volume: ayar.volume,
    })
  }
  return liste
}

function kapaliOku() {
  try { return localStorage.getItem(VIDEO_PANE_KEY) === '1' } catch { return false }
}
function kapaliYaz(b) {
  try { localStorage.setItem(VIDEO_PANE_KEY, b ? '1' : '0') } catch { /* sorun değil */ }
}

function el(etiket, sinif) {
  const e = document.createElement(etiket)
  if (sinif) e.className = sinif
  return e
}

// Elemanları kap'ın içinde verilen sırayla dizer (yerinde olanı oynatmaz; video takılmasın).
// Tam ekrandaki kutucuğa HİÇ dokunmaz: taşımak onu belgeden bir an çıkarır ve tam ekran kapanır.
function sirala(kap, elemanlar) {
  const tam = document.fullscreenElement ?? null
  const sabit = tam?.parentNode === kap ? tam : null // olduğu yerde kalır, diğerleri etrafına dizilir
  let sonraki = kap.firstElementChild // sıradaki eleman bunun önüne gelir (null = sona)
  for (const e of elemanlar) {
    if (e === tam) continue
    if (sonraki === sabit && sabit) sonraki = sonraki.nextElementSibling
    if (sonraki === e) { sonraki = e.nextElementSibling; continue } // zaten yerinde
    kap.insertBefore(e, sonraki)
  }
}

// container içine bölmeyi kurar.
// getPeers(): buildVideoPeers biçiminde liste; onHide(peerId, gizli); onVolume(peerId, 0..1)
// update(): listeyi yeniden okuyup çizer; dispose(): her şeyi bırakır.
export function mountVideoPane(container, { getPeers, onHide, onVolume }) {
  const kok = el('section', 'video-pane')
  kok.hidden = true
  const baslik = el('button', 'video-pane-toggle')
  baslik.type = 'button'
  const govde = el('div', 'video-pane-body')
  const sahne = el('div', 'video-stage') // büyük kutucuklar
  const serit = el('div', 'video-strip') // küçük kutucuklar
  const kontroller = el('div', 'video-controls') // kaydırıcılar + gizle düğmeleri
  const notlar = el('div', 'video-notes') // eski sürüm notları
  govde.append(sahne, serit, kontroller, notlar)
  kok.append(baslik, govde)
  container.appendChild(kok)

  const kutular = new Map() // "kişi:yuva" -> { kutu, video, ad, iz }
  const satirlar = new Map() // kişi -> { satir, ad, kaydirici, dugme }
  const izDinleyicileri = new Map() // iz -> update (mute/unmute için)
  let odak = null // büyütülen kutucuğun anahtarı
  let kapali = kapaliOku()
  let oncekiVideoVar = null // null: henüz hiç çizilmedi
  let bitti = false
  let notAnahtari = '' // son çizilen eski sürüm notlarının listesi (değişmedikçe yeniden kurma)

  function basligiCiz() {
    baslik.textContent = (kapali ? '▸ ' : '▾ ') + 'Görüntü'
    baslik.setAttribute('aria-expanded', String(!kapali))
    govde.hidden = kapali
  }
  baslik.onclick = () => {
    kapali = !kapali
    kapaliYaz(kapali)
    basligiCiz()
  }
  basligiCiz()

  // Bir izin mute/unmute olaylarını dinle (bir kez)
  function iziDinle(iz) {
    if (!iz?.addEventListener || izDinleyicileri.has(iz)) return
    const cb = () => update()
    iz.addEventListener('mute', cb)
    iz.addEventListener('unmute', cb)
    izDinleyicileri.set(iz, cb)
  }
  function iziBirak(iz) {
    const cb = izDinleyicileri.get(iz)
    iz.removeEventListener?.('mute', cb)
    iz.removeEventListener?.('unmute', cb)
    izDinleyicileri.delete(iz)
  }

  function kutuKur(anahtar, kisi, yuva) {
    const kutu = el('div', 'video-tile ' + yuva)
    kutu.dataset.key = anahtar
    const video = el('video')
    video.autoplay = true
    video.playsInline = true
    video.muted = true // ses ayrı <audio>'dan çalar
    if (kisi.self && yuva === 'camera') video.classList.add('mirror') // kendi kameramız ayna gibi
    const ad = el('span', 'video-name')
    kutu.append(video, ad)
    kutu.addEventListener('click', () => {
      if (document.fullscreenElement) return // tam ekrandayken düzen değişmesin
      odak = odak === anahtar ? null : anahtar
      update()
    })
    kutu.addEventListener('dblclick', () => {
      // Tam ekrandaysa çık, değilse gir. İzin verilmezse/desteklenmezse sessizce geç.
      try {
        if (document.fullscreenElement === kutu) document.exitFullscreen?.()?.catch?.(() => {})
        else kutu.requestFullscreen?.()?.catch?.(() => {})
      } catch { /* desteklenmiyor */ }
    })
    return { kutu, video, ad, iz: null }
  }

  function kutuKaldir(anahtar) {
    const k = kutular.get(anahtar)
    k.video.srcObject = null
    k.kutu.remove()
    kutular.delete(anahtar)
  }

  // Bir paylaşanın kontrol satırı: ad, (ekran varsa) ses kaydırıcısı, gizle/göster
  function satirKur(kisi) {
    const satir = el('div', 'video-control')
    const ad = el('span', 'video-control-name')
    const kaydirici = el('input')
    kaydirici.type = 'range'
    kaydirici.min = '0'
    kaydirici.max = '100'
    kaydirici.title = 'Ekran sesi'
    kaydirici.setAttribute('aria-label', 'Ekran sesi')
    kaydirici.addEventListener('input', () => onVolume?.(kisi.id, Number(kaydirici.value) / 100))
    const dugme = el('button', 'secondary video-hide-btn')
    dugme.type = 'button'
    dugme.addEventListener('click', () => onHide?.(kisi.id, !satirlar.get(kisi.id).gizli))
    satir.append(ad, kaydirici, dugme)
    return { satir, ad, kaydirici, dugme, gizli: false }
  }

  function update() {
    if (bitti) return
    const kisiler = getPeers() ?? []
    const gorunen = [] // { anahtar, kisi, yuva, iz }
    const izler = new Set()
    let videoVar = false // biri (biz dahil) kamera ya da ekran açmış mı (presence)
    for (const kisi of kisiler) {
      for (const yuva of ['screen', 'camera']) {
        const iz = kisi.tracks?.[yuva] ?? null
        if (iz) { izler.add(iz); iziDinle(iz) }
        if (!kisi[yuva]) continue // presence kapalı
        videoVar = true
        if (!iz || iz.muted) continue // iz yok ya da akmıyor: donmuş kare gösterme
        if (kisi.hidden && !kisi.self) continue // "Görüntüyü gizle"
        gorunen.push({ anahtar: `${kisi.id}:${yuva}`, kisi, yuva, iz })
      }
    }
    // Artık bakmadığımız izlerin dinleyicilerini bırak
    for (const iz of [...izDinleyicileri.keys()]) if (!izler.has(iz)) iziBirak(iz)

    // Bölme: görüntü yoksa gizli; ilk görüntü gelince kendiliğinden açılır
    kok.hidden = !videoVar
    if (oncekiVideoVar === false && videoVar && kapali) {
      kapali = false
      kapaliYaz(false)
      basligiCiz()
    }
    oncekiVideoVar = videoVar

    // Kutucuklar: gitmesi gerekenleri kaldır, yenileri kur, izleri bağla
    const anahtarlar = new Set(gorunen.map((g) => g.anahtar))
    for (const a of [...kutular.keys()]) if (!anahtarlar.has(a)) kutuKaldir(a)
    if (odak && !anahtarlar.has(odak)) odak = null
    for (const g of gorunen) {
      if (!kutular.has(g.anahtar)) kutular.set(g.anahtar, kutuKur(g.anahtar, g.kisi, g.yuva))
      const k = kutular.get(g.anahtar)
      if (k.iz !== g.iz) {
        k.iz = g.iz
        k.video.srcObject = globalThis.MediaStream ? new MediaStream([g.iz]) : null
        try { k.video.play()?.catch?.(() => {}) } catch { /* otomatik oynatma engeli */ }
      }
      k.ad.textContent = g.kisi.self ? 'Sen' : g.kisi.name
      k.kutu.classList.toggle('speaking', !!g.kisi.speaking)
      k.kutu.classList.toggle('focused', g.anahtar === odak)
    }
    // Yerleşim: odak varsa yalnız o büyük; yoksa ekranlar büyük, kameralar küçük
    const buyuk = odak ? gorunen.filter((g) => g.anahtar === odak) : gorunen.filter((g) => g.yuva === 'screen')
    const kucuk = gorunen.filter((g) => !buyuk.includes(g))
    sirala(sahne, buyuk.map((g) => kutular.get(g.anahtar).kutu))
    sirala(serit, kucuk.map((g) => kutular.get(g.anahtar).kutu))
    sahne.hidden = buyuk.length === 0
    serit.hidden = kucuk.length === 0

    // Kontroller: kamerası ya da ekranı açık her karşıdaki kişi (gizliyse de: geri açabilsin)
    const paylasanlar = kisiler.filter((k) => !k.self && (k.camera || k.screen))
    const ids = new Set(paylasanlar.map((k) => k.id))
    for (const id of [...satirlar.keys()]) {
      if (!ids.has(id)) { satirlar.get(id).satir.remove(); satirlar.delete(id) }
    }
    for (const kisi of paylasanlar) {
      if (!satirlar.has(kisi.id)) satirlar.set(kisi.id, satirKur(kisi))
      const s = satirlar.get(kisi.id)
      s.gizli = !!kisi.hidden
      s.ad.textContent = kisi.name
      s.kaydirici.hidden = !kisi.screen // ses kaydırıcısı yalnız ekran paylaşana
      s.kaydirici.disabled = s.gizli
      // Sürüklenirken değeri ezme
      if (document.activeElement !== s.kaydirici) s.kaydirici.value = String(Math.round((kisi.volume ?? 1) * 100))
      s.dugme.textContent = s.gizli ? 'Görüntüyü göster' : 'Görüntüyü gizle'
    }
    sirala(kontroller, paylasanlar.map((k) => satirlar.get(k.id).satir))
    kontroller.hidden = paylasanlar.length === 0

    // Eski sürüm notları (yalnız liste değişince yeniden kurulur)
    const eskiler = kisiler.filter((k) => !k.self && k.videoCap === false)
    const anahtar = JSON.stringify(eskiler.map((k) => [k.id, k.name]))
    if (anahtar !== notAnahtari) {
      notAnahtari = anahtar
      notlar.textContent = ''
      for (const kisi of eskiler) {
        const p = el('p', 'video-note')
        p.textContent = `${kisi.name}: ${OLD_VERSION_NOTE}`
        notlar.appendChild(p)
      }
    }
    notlar.hidden = eskiler.length === 0
  }

  function dispose() {
    if (bitti) return
    bitti = true
    for (const iz of [...izDinleyicileri.keys()]) iziBirak(iz)
    for (const a of [...kutular.keys()]) kutuKaldir(a)
    satirlar.clear()
    kok.remove()
  }

  return { update, dispose }
}
