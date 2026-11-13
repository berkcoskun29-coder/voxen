// Sesli oturum: bir sesli kanala katılınca gereken her şeyi bir araya getirir.
//   mikrofon -> ses hattı (gürültü engelleme + kapı) -> örgü (PeerMesh) -> karşıdakiler
//   karşıdakiler -> gizli <audio> elemanları -> hoparlör
//   karşıdakilerin ekran sesi -> her eşe AYRI bir gizli <audio> (ses seviyesi kaydırıcısı bunu ayarlar)
// Ayrıca: susturma, sağırlaştırma, konuşan halkaları, katılma/ayrılma bipleri.
import { openMic, createVoicePipeline, MIC_MESSAGES } from './pipeline.js'
import { openCamera, CAMERA_MESSAGES } from './camera.js'
import { startScreenShare, SCREEN_HEADPHONE_WARNING } from './screenShare.js'
import { PeerMesh, clampBitrate } from './mesh.js'
import { supabaseSignal } from './signal.js'
import { playBeep } from './sounds.js'
import { isSpeaking } from './level.js'
import { getNoiseSuppressionPref } from '../ui/micTest.js'
import { getSettings, updateSettings } from '../settings.js'
import { ICE_SERVERS } from '../config.js'

export const SELF_SPEAKING_POLL_MS = 100
// shareState: durumumuz bu aralıkla yeniden gönderilir (yayın en fazla bir kez iletilir; kaybolan ileti telafi edilir)
export const STATE_RESEND_MS = 10000

// muted / deafened: başlangıç durumu (kullanıcı çubuğundaki son seçim; kanalda değilken tercih olarak tutulur).
// topic: sinyal konusu (verilmezse "voice:<channelId>"). DM araması channelId yerine arama kimliğini
// ve topic olarak "dm-voice:<arama id>" verir (bkz. data/calls.js callTopic).
// shareState: true ise susturma/sağırlaştırma durumumuz sinyal konusundan karşıya gider ve karşınınki
// getPeerState ile okunur (DM araması; kanalda voice_states tablosu kullanıldığı için kapalı).
// deps sadece testler içindir.
export function createVoiceSession({ channelId, topic, userId, muted = false, deafened = false, shareState = false, deps = {} }) {
  const konu = topic ?? `voice:${channelId}`
  const d = {
    openMic,
    openCamera,
    startScreenShare,
    createVoicePipeline,
    createMesh: (opts) => new PeerMesh(opts),
    playBeep,
    getNoiseSuppressionPref,
    signal: supabaseSignal,
    ...deps,
  }

  // Arayüzün göreceği durum
  const state = {
    status: 'connecting', // 'connecting' | 'connected' | 'failed'
    micError: null, // Türkçe mikrofon hatası (varsa)
    listenOnly: false, // mikrofon yok: sadece dinliyoruz
    muted: !!muted, // Sustur
    deafened: !!deafened, // Sağırlaştır
    camera: false, // kamera açık mı
    cameraError: null, // Türkçe kamera hatası (varsa)
    screen: false, // ekran paylaşımı açık mı
    screenError: null, // Türkçe ekran paylaşımı hatası (varsa)
    speaking: new Set(), // şu an konuşanların kimlikleri (biz dahil)
  }
  let transmitting = true // bas-konuş / sesle algılama (PttController) bunu değiştirir
  let cikisCihazi = null // hoparlör kimliği (null = varsayılan)
  let hat = null // ses hattı
  let kameraIzi = null // açık kameranın izi
  let kameraCihazi = null // açık kameranın cihazı (null = varsayılan)
  let ekran = null // açık paylaşım: { video, audio, stop() }
  let mesh = null
  let bitti = false // leave() çağrıldı mı
  let sayac = 0
  let durumSayaci = 0 // shareState: durumun düzenli yeniden gönderimi
  let bitrate = null
  let uploadMbps = null // görüntü upload bütçesi (ayarlardan)
  let odadaEkran = false // kanalda başka biri ekran paylaşıyor mu (kamera bütçesi için)
  const sesler = new Map() // userId -> <audio>
  // Görüntü (2. aşama): karşıdan gelen izler ve ekran sesleri
  const bagliEsler = new Set() // bağlantısı kurulmuş eşler (cap'lerini ancak bunlar için biliriz)
  const uzakIzler = new Map() // userId -> { camera, screen, screenAudio } (gelen izler)
  const ekranSesleri = new Map() // userId -> ekran sesi için <audio> (mikrofon sesinden ayrı)
  const ekranAyari = new Map() // userId -> { volume: 0..1, hidden } (izleyenin kendi tercihi)
  const dinleyiciler = { change: new Set(), speaking: new Set(), notice: new Set(), tracks: new Set() }
  const karsiDurumlari = new Map() // shareState: userId -> { muted, deafened, camera, screen } (karşının bildirdiği)
  let sonGonderilen = '' // shareState: en son gönderdiğimiz durum (değişmediyse yeniden gönderme)

  // shareState açıksa kendi durumumuzu karşıya bildir (örgü yoksa ya da kanal yolunda bir şey yapmaz).
  // zorla: yeni bağlanan eş ya da hazır olunca; aksi hâlde yalnız durum değiştiyse gönderilir.
  function durumuGonder(zorla = true) {
    if (!shareState || !mesh?.sendState) return
    const durum = { muted: state.muted, deafened: state.deafened, camera: state.camera, screen: state.screen }
    const anahtar = JSON.stringify(durum)
    if (!zorla && anahtar === sonGonderilen) return
    sonGonderilen = anahtar
    mesh.sendState(durum)
  }

  // yayKarsi: karşının durum iletisinden doğan değişiklik (geri gönderim yapılmaz; yankı döngüsü olmasın)
  function yay(olay, { yayKarsi = false } = {}) {
    // Kamera/ekran açılıp kapanınca karşı taraf görüntü bölmesini güncelleyebilsin
    if (olay === 'change' && !yayKarsi) durumuGonder(false)
    for (const cb of dinleyiciler[olay]) cb(olay === 'speaking' ? state.speaking : state)
  }

  // Kapı (mikrofonun karşıya gitmesi) = konuşma izni VE susturulmamış VE sağır değil
  function kapiyiAyarla() {
    hat?.setGate(transmitting && !state.muted && !state.deafened)
  }

  function konusmaAyarla(id, konusuyor) {
    if (konusuyor === state.speaking.has(id)) return
    if (konusuyor) state.speaking.add(id)
    else state.speaking.delete(id)
    yay('speaking')
  }

  // Karşıdan gelen ses için gizli bir <audio> (her eşe bir tane)
  function sesEkle(peerId, stream) {
    sesKaldir(peerId)
    if (!stream) return
    const a = document.createElement('audio')
    a.autoplay = true
    a.hidden = true
    a.srcObject = stream
    a.muted = state.deafened
    if (cikisCihazi) a.setSinkId?.(cikisCihazi)?.catch?.(() => {})
    document.body.appendChild(a)
    sesler.set(peerId, a)
    // Katılma tıklaması bir kullanıcı hareketi; yine de tarayıcı engellerse sorun etme
    try { a.play()?.catch?.(() => {}) } catch { /* otomatik oynatma engeli */ }
  }
  function sesKaldir(peerId) {
    const a = sesler.get(peerId)
    if (!a) return
    a.srcObject = null
    a.remove()
    sesler.delete(peerId)
  }

  // --- Ekran sesi: her paylaşan için ayrı <audio> ---
  // Mikrofon sesi sesEkle'deki <audio>'dan çalar; ekran sesi ayrı bir izdir (mikrofon akışında yok),
  // bu yüzden iki kez çalmaz. Sağırken susar; "Görüntüyü gizle" ya da kaydırıcı ses seviyesini ayarlar.
  function ekranAyariAl(peerId) {
    return ekranAyari.get(peerId) ?? { volume: 1, hidden: false }
  }
  function ekranSesiniAyarla(peerId) {
    const a = ekranSesleri.get(peerId)
    if (!a) return
    const { volume, hidden } = ekranAyariAl(peerId)
    a.volume = hidden ? 0 : volume
    a.muted = state.deafened
  }
  function ekranSesiKaldir(peerId) {
    const a = ekranSesleri.get(peerId)
    if (!a) return
    a.srcObject = null
    a.remove()
    ekranSesleri.delete(peerId)
  }
  function ekranSesiKur(peerId, iz) {
    ekranSesiKaldir(peerId)
    if (!iz || !globalThis.MediaStream) return
    const a = document.createElement('audio')
    a.autoplay = true
    a.hidden = true
    a.dataset.screenAudio = peerId
    a.srcObject = new MediaStream([iz])
    if (cikisCihazi) a.setSinkId?.(cikisCihazi)?.catch?.(() => {})
    document.body.appendChild(a)
    ekranSesleri.set(peerId, a)
    ekranSesiniAyarla(peerId)
    try { a.play()?.catch?.(() => {}) } catch { /* otomatik oynatma engeli */ }
  }

  // Örgüden gelen 'peer-track': izi kaydet (track null = kalktı), ekran sesini çal, arayüze haber ver
  function uzakIzGeldi({ peerId, slot, track }) {
    const izler = uzakIzler.get(peerId) ?? {}
    if (track) izler[slot] = track
    else delete izler[slot]
    if (Object.keys(izler).length) uzakIzler.set(peerId, izler)
    else uzakIzler.delete(peerId)
    if (slot === 'screenAudio') ekranSesiKur(peerId, track)
    yay('tracks')
  }

  const internetGeldi = () => mesh?.reconnect()

  // Durum yazısı: bağlanamadığımız biri varsa "Doğrudan bağlantı kurulamadı";
  // herkesle bağlantı (yeniden) kurulunca "Bağlandı"; henüz kanala bağlanmadıysak "Bağlanıyor…"
  let baglandik = false
  function durumuGuncelle() {
    if (!mesh) return
    const yeni = mesh.failedPeerCount() > 0 ? 'failed' : baglandik ? 'connected' : 'connecting'
    if (yeni !== state.status) {
      state.status = yeni
      yay('change')
    }
  }

  async function join() {
    // 1) Mikrofon ve ses hattı. Olmazsa sadece dinleyici olarak devam.
    let mikrofon = null
    try {
      const kayitli = getSettings().inputDeviceId ?? undefined
      try {
        mikrofon = await d.openMic(kayitli)
      } catch (e) {
        // Kayıtlı mikrofon çıkarılmışsa varsayılana dön ve eski seçimi unut
        if (kayitli && e?.code === 'no-mic') {
          updateSettings({ inputDeviceId: null })
          mikrofon = await d.openMic()
        } else throw e
      }
      if (bitti) { mikrofon.getTracks().forEach((t) => t.stop()); return }
      hat = await d.createVoicePipeline(mikrofon, { noiseSuppression: d.getNoiseSuppressionPref() })
      if (bitti) { hat.close(); hat = null; return }
    } catch (e) {
      if (bitti) return
      hat = null
      state.listenOnly = true
      state.muted = true
      state.micError = MIC_MESSAGES[e?.code] ?? 'Mikrofon açılamadı. Başka bir uygulama kullanıyor olabilir.'
    }
    kapiyiAyarla()

    // 2) Örgü: sinyal kanalı voice:<channelId> (aramada dm-voice:<arama id>)
    mesh = d.createMesh({
      channelId,
      topic: konu,
      userId,
      localStream: hat?.outputStream ?? null,
      iceServers: ICE_SERVERS,
      signal: d.signal,
    })
    if (bitrate != null) mesh.setBitrate(bitrate)
    if (uploadMbps != null) mesh.setUploadMbps?.(uploadMbps)
    if (odadaEkran) mesh.setRoomScreenOn?.(true)
    mesh.setDeafened(state.deafened)
    mesh.on('ready', () => { baglandik = true; durumuGonder(); durumuGuncelle() })
    mesh.on('peer-joined', ({ userId: id, stream }) => {
      sesEkle(id, stream)
      bagliEsler.add(id)
      durumuGonder() // yeni bağlanan eş durumumuzu bilsin
      yay('tracks') // bu eşin görüntü cap'i artık belli (eski sürüm notu için)
      baglandik = true
      durumuGuncelle()
    })
    mesh.on('peer-left', ({ userId: id }) => {
      sesKaldir(id)
      ekranSesiKaldir(id)
      uzakIzler.delete(id)
      bagliEsler.delete(id)
      const durumuVardi = karsiDurumlari.delete(id)
      konusmaAyarla(id, false)
      if (durumuVardi) yay('change', { yayKarsi: true }) // karşının susturma simgesi bayat kalmasın
      yay('tracks')
    })
    mesh.on('peer-track', uzakIzGeldi)
    mesh.on('peer-speaking', ({ userId: id, speaking }) => konusmaAyarla(id, speaking))
    if (shareState) {
      mesh.on('peer-state', ({ userId: id, muted: m, deafened: s, camera: k, screen: e }) => {
        karsiDurumlari.set(id, { muted: !!m, deafened: !!s, camera: !!k, screen: !!e })
        yay('change', { yayKarsi: true })
        yay('tracks') // görüntü bölmesi karşının kamera/ekran durumunu yeniden okusun
      })
    }
    mesh.on('connect-failed', durumuGuncelle)
    mesh.on('failed-change', durumuGuncelle)
    mesh.join()
    d.playBeep('join')
    window.addEventListener('online', internetGeldi)

    // 3) Kendi konuşan halkamız: 100 ms'de bir seviye (kapı açıkken)
    sayac = setInterval(() => {
      const acik = !!hat && transmitting && !state.muted && !state.deafened
      konusmaAyarla(userId, acik && isSpeaking(hat.getLevel()))
    }, SELF_SPEAKING_POLL_MS)
    if (shareState) durumSayaci = setInterval(() => durumuGonder(), STATE_RESEND_MS)
    yay('change')
  }

  function leave() {
    if (bitti) return
    bitti = true
    clearInterval(sayac)
    clearInterval(durumSayaci)
    window.removeEventListener('online', internetGeldi)
    if (mesh) {
      mesh.leave() // bye gönderir, bağlantıları kapatır
      d.playBeep('leave')
    }
    mesh = null
    for (const id of [...sesler.keys()]) sesKaldir(id)
    for (const id of [...ekranSesleri.keys()]) ekranSesiKaldir(id)
    uzakIzler.clear()
    bagliEsler.clear()
    karsiDurumlari.clear()
    ekranAyari.clear()
    hat?.close()
    hat = null
    kameraIzi?.stop() // kamera ışığı açık kalmasın (örgü zaten kapandı, yuvayı boşaltmaya gerek yok)
    kameraIzi = null
    ekran?.stop() // ekran paylaşımı da kapansın (örgü zaten kapandı)
    ekran = null
    state.screen = false
    state.camera = false
    state.speaking.clear()
  }

  // Kamerayı açar (kayıtlı cihaz yoksa varsayılana döner ve eski seçimi unutur).
  // { iz, id } döner: id = gerçekte kullanılan cihaz (null = varsayılan)
  async function kameraAc() {
    const kayitli = getSettings().cameraDeviceId
    try {
      return { iz: await d.openCamera(kayitli || undefined), id: kayitli }
    } catch (e) {
      if (kayitli && e?.code === 'no-camera') {
        updateSettings({ cameraDeviceId: null })
        return { iz: await d.openCamera(), id: null }
      }
      throw e
    }
  }

  // Açık kamerayı bırakır: iz durur, örgüdeki yuva boşalır
  async function kameraKapat() {
    const iz = kameraIzi
    kameraIzi = null
    state.camera = false
    iz?.stop()
    await mesh?.setLocalTrack('camera', null)
  }

  // Yeni izi takar. Önce örgüye takılır; ancak başarılıysa "açık" sayılır, eski iz durdurulur.
  // Başarısızsa yeni iz durdurulur, eski iz (varsa) yuvaya geri konur. Hata yukarı fırlar.
  async function kameraTak(iz, id) {
    const eski = kameraIzi
    try {
      await mesh.setLocalTrack('camera', iz)
    } catch (e) {
      iz.stop()
      await mesh?.setLocalTrack('camera', eski)?.catch?.(() => {})
      throw e
    }
    if (bitti) { iz.stop(); return } // takılırken ayrıldık
    kameraIzi = iz
    kameraCihazi = id
    state.camera = true
    if (eski && eski !== iz) eski.stop()
    // Kullanıcı kamerayı sistemden keserse (ended) kendiliğinden kapanır
    iz.addEventListener?.('ended', () => {
      sirala(async () => {
        if (kameraIzi !== iz || bitti) return
        await kameraKapat()
        yay('change')
      })
    })
  }

  // Aç/kapa/değiştir işlemleri tek sırada çalışır: art arda tıklamada ikinci kamera açılmaz,
  // açılırken gelen "kapat" açılış bitince uygulanır (sonuç kapalı, iz durmuş).
  let kuyruk = Promise.resolve()
  function sirala(is) {
    const sonuc = kuyruk.then(is)
    kuyruk = sonuc.catch(() => {})
    return sonuc
  }

  function setCamera(b) {
    return sirala(async () => {
      state.cameraError = null
      if (!b) {
        if (state.camera) await kameraKapat()
        yay('change')
        return
      }
      if (state.camera) return
      // Henüz bağlanmadık (örgü yok) ya da ayrıldık: açamayız, ama arayüz yeniden çizilsin (tıklama kaybolmasın)
      if (!mesh || bitti) { yay('change'); return }
      try {
        const { iz, id } = await kameraAc()
        if (bitti) { iz.stop(); return }
        await kameraTak(iz, id)
      } catch (e) {
        state.cameraError = CAMERA_MESSAGES[e?.code] ?? 'Kamera açılamadı'
      }
      yay('change')
    })
  }

  // Kamera açıkken ayarlardan cihaz değişti: yeni kamerayı aç, izi değiştir, eskisini durdur.
  // Seçili cihaz zaten kullanılıyorsa bir şey yapmaz (yedek cihaza dönüşte ikinci geçiş olmaz).
  function switchCamera() {
    return sirala(async () => {
      if (!state.camera || !mesh || bitti) return
      if ((getSettings().cameraDeviceId ?? null) === kameraCihazi) return
      try {
        const { iz, id } = await kameraAc()
        if (bitti) { iz.stop(); return }
        await kameraTak(iz, id)
        state.cameraError = null
      } catch (e) {
        state.cameraError = CAMERA_MESSAGES[e?.code] ?? 'Kamera açılamadı' // eski kamera çalışmaya devam eder
      }
      yay('change')
    })
  }

  // --- Ekran paylaşımı (kamerayla aynı kuyrukta: aynı anda tek işlem) ---

  // Açık paylaşımı bırakır: izler durur, iki yuva da boşalır
  async function ekranKapat() {
    const e = ekran
    ekran = null
    state.screen = false
    e?.stop()
    try {
      await mesh?.setLocalTrack('screen', null)
    } finally {
      await mesh?.setLocalTrack('screenAudio', null) // ilki hata verse de ses yuvası mutlaka boşalır
    }
  }

  // Yeni paylaşımı örgüye takar; ancak ikisi de başarılıysa "açık" sayılır.
  // Başarısızsa izler durur ve yuvalar boşaltılır. Hata yukarı fırlar.
  async function ekranTak(yeni) {
    try {
      await mesh.setLocalTrack('screen', yeni.video)
      await mesh.setLocalTrack('screenAudio', yeni.audio) // ses yoksa null
    } catch (e) {
      yeni.stop()
      await mesh?.setLocalTrack('screen', null)?.catch?.(() => {})
      await mesh?.setLocalTrack('screenAudio', null)?.catch?.(() => {})
      throw e
    }
    if (bitti) { yeni.stop(); return false } // takılırken ayrıldık
    ekran = yeni
    state.screen = true
    // Kullanıcı paylaşımı sistemden keserse (ended) ses ve görüntü birlikte kapanır
    yeni.video.addEventListener?.('ended', () => {
      sirala(async () => {
        if (ekran !== yeni || bitti) return
        await ekranKapat()
        yay('change')
      })
    })
    // Yalnız ses izi biterse (ses paylaşımı kesildi) ses yuvası boşalır, görüntü sürer
    yeni.audio?.addEventListener?.('ended', () => {
      sirala(async () => {
        if (ekran !== yeni || bitti) return
        await mesh?.setLocalTrack('screenAudio', null)
      })
    })
    return true
  }

  function setScreenShare(b, mode) {
    return sirala(async () => {
      state.screenError = null
      if (!b) {
        if (state.screen) await ekranKapat()
        yay('change')
        return
      }
      if (state.screen) return
      // Henüz bağlanmadık (örgü yok) ya da ayrıldık: başlatamayız, ama arayüz yeniden çizilsin
      if (!mesh || bitti) { yay('change'); return }
      try {
        const yeni = await d.startScreenShare({ mode: mode ?? getSettings().screenMode })
        if (bitti) { yeni.stop(); return }
        if (await ekranTak(yeni) && yeni.audio) {
          for (const cb of dinleyiciler.notice) cb(SCREEN_HEADPHONE_WARNING) // her paylaşımda bir kez
        }
      } catch (e) {
        // Seçiciyi kapatmak hata değildir: sessizce vazgeç
        // Masaüstünde desteklenmiyorsa (code 'unsupported') mesaj zaten Türkçe uyarıdır
        if (e?.code === 'unsupported') state.screenError = e.message
        else if (e?.code !== 'cancelled') state.screenError = 'Ekran paylaşımı başlatılamadı'
      }
      yay('change')
    })
  }

  function setMuted(b) {
    state.muted = state.listenOnly ? true : !!b // mikrofon yoksa hep susturulmuş
    kapiyiAyarla()
    durumuGonder()
    yay('change')
  }

  // Sağırlaştır: gelen sesler (örgü + <audio>) ve kendi mikrofonumuz kapanır
  function setDeafened(b) {
    state.deafened = !!b
    mesh?.setDeafened(state.deafened)
    for (const a of sesler.values()) a.muted = state.deafened
    for (const id of ekranSesleri.keys()) ekranSesiniAyarla(id) // ekran sesi de susar
    kapiyiAyarla()
    durumuGonder()
    yay('change')
  }

  return {
    channelId,
    topic: konu,
    join,
    leave,
    getState: () => state,
    // Bağlantısı kurulmuş eşlerin kimlikleri (DM araması "bağlantı koptu" kuralı için)
    connectedPeers: () => [...bagliEsler],
    // shareState: karşının bildirdiği { muted, deafened, camera, screen } (henüz bildirmediyse null)
    getPeerState: (peerId) => karsiDurumlari.get(peerId) ?? null,
    // olay: 'change' (durum/susturma/hata), 'speaking' (konuşanlar kümesi)
    // ya da 'tracks' (karşının kamera/ekran izleri ya da bir eşin bağlantısı değişti)
    on(olay, cb) {
      dinleyiciler[olay].add(cb)
      return () => dinleyiciler[olay].delete(cb)
    },
    setMuted,
    toggleMute: () => setMuted(!state.muted),
    setDeafened,
    toggleDeafen: () => setDeafened(!state.deafened),
    setCamera,
    toggleCamera: () => setCamera(!state.camera),
    switchCamera,
    setScreenShare,
    toggleScreenShare: (mode) => setScreenShare(!state.screen, mode),
    // Görev 8: bas-konuş tuşu / sesle algılama kapıyı buradan sürer
    setTransmitting(b) {
      transmitting = !!b
      kapiyiAyarla()
    },
    // Görev 8 kalite kaydırıcısı: 32–128 kbps
    setBitrate(kbps) {
      bitrate = clampBitrate(kbps)
      mesh?.setBitrate(bitrate)
      return bitrate
    },
    // Görüntü için toplam upload (5/10/20 Mbps); örgü bütçeyi yeniden hesaplar
    setUploadMbps(mbps) {
      uploadMbps = mbps
      mesh?.setUploadMbps?.(mbps)
    },
    // Kanalda başka biri ekran paylaşıyor mu: kameramız 500 kbps / ≈360p'ye iner (bkz. videoBudget.js)
    setRoomScreenOn(b) {
      odadaEkran = !!b
      mesh?.setRoomScreenOn?.(odadaEkran)
    },
    // Mikrofon seviyesi 0..1 (kapıdan önce ölçülür; sesle algılama bunu okur)
    getLevel: () => hat?.getLevel() ?? 0,
    // Hoparlör seç (destekleyen tarayıcılarda); yeni gelen seslere de uygulanır
    setOutputDevice(id) {
      cikisCihazi = id || null
      for (const a of [...sesler.values(), ...ekranSesleri.values()]) a.setSinkId?.(cikisCihazi ?? '')?.catch?.(() => {})
    },
    // --- Görüntü bölmesi için ---
    // Kendi açık kamera/ekran izlerimiz (önizleme)
    getLocalTracks: () => ({ camera: kameraIzi, screen: ekran?.video ?? null }),
    // Karşının gelen izleri: { camera?, screen?, screenAudio? }
    getRemoteTracks: (peerId) => ({ ...(uzakIzler.get(peerId) ?? {}) }),
    // Eş görüntü alabiliyor mu? true/false; bağlantı henüz yoksa null (bilinmiyor)
    peerHasVideo(peerId) {
      if (!bagliEsler.has(peerId) || !mesh?.peerCaps) return null
      return mesh.peerCaps(peerId).includes('video')
    },
    // Bu eşin ekran sesi tercihimiz: { volume: 0..1, hidden }
    getScreenAudio: (peerId) => ({ ...ekranAyariAl(peerId) }),
    // Ekran sesi seviyesi (0..1, aralık dışı sıkıştırılır)
    setScreenVolume(peerId, v) {
      const volume = Math.min(1, Math.max(0, Number(v) || 0))
      ekranAyari.set(peerId, { ...ekranAyariAl(peerId), volume })
      ekranSesiniAyarla(peerId)
    },
    // "Görüntüyü gizle": ekran sesi de kısılır (0). Not: P2P'de akış gelmeye devam eder,
    // yalnız biz göstermeyiz/çalmayız; karşıya "gönderme" diyemeyiz.
    setScreenHidden(peerId, b) {
      ekranAyari.set(peerId, { ...ekranAyariAl(peerId), hidden: !!b })
      ekranSesiniAyarla(peerId)
    },
    // Gürültü engelleme anahtarı (ayarlar ekranı için)
    setNoiseSuppression(b) { hat?.setNoiseSuppression(b) },
  }
}
