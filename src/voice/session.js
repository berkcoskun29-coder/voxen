// Sesli oturum: bir sesli kanala katılınca gereken her şeyi bir araya getirir.
//   mikrofon -> ses hattı (gürültü engelleme + kapı) -> örgü (PeerMesh) -> karşıdakiler
//   karşıdakiler -> gizli <audio> elemanları -> hoparlör
// Ayrıca: susturma, sağırlaştırma, konuşan halkaları, katılma/ayrılma bipleri.
import { openMic, createVoicePipeline, MIC_MESSAGES } from './pipeline.js'
import { PeerMesh, clampBitrate } from './mesh.js'
import { supabaseSignal } from './signal.js'
import { playBeep } from './sounds.js'
import { isSpeaking } from './level.js'
import { getNoiseSuppressionPref } from '../ui/micTest.js'
import { getSettings, updateSettings } from '../settings.js'
import { ICE_SERVERS } from '../config.js'

export const SELF_SPEAKING_POLL_MS = 100

// deps sadece testler içindir.
export function createVoiceSession({ channelId, userId, deps = {} }) {
  const d = {
    openMic,
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
    muted: false, // Sustur
    deafened: false, // Sağırlaştır
    speaking: new Set(), // şu an konuşanların kimlikleri (biz dahil)
  }
  let transmitting = true // bas-konuş / sesle algılama (PttController) bunu değiştirir
  let cikisCihazi = null // hoparlör kimliği (null = varsayılan)
  let hat = null // ses hattı
  let mesh = null
  let bitti = false // leave() çağrıldı mı
  let sayac = 0
  let bitrate = null
  const sesler = new Map() // userId -> <audio>
  const dinleyiciler = { change: new Set(), speaking: new Set() }

  function yay(olay) {
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
      state.micError = MIC_MESSAGES[e?.code] ?? 'Mikrofon açılamadı'
    }
    kapiyiAyarla()

    // 2) Örgü: sinyal kanalı voice:<channelId>
    mesh = d.createMesh({
      channelId,
      userId,
      localStream: hat?.outputStream ?? null,
      iceServers: ICE_SERVERS,
      signal: d.signal,
    })
    if (bitrate != null) mesh.setBitrate(bitrate)
    mesh.setDeafened(state.deafened)
    mesh.on('ready', () => { baglandik = true; durumuGuncelle() })
    mesh.on('peer-joined', ({ userId: id, stream }) => {
      sesEkle(id, stream)
      baglandik = true
      durumuGuncelle()
    })
    mesh.on('peer-left', ({ userId: id }) => {
      sesKaldir(id)
      konusmaAyarla(id, false)
    })
    mesh.on('peer-speaking', ({ userId: id, speaking }) => konusmaAyarla(id, speaking))
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
    yay('change')
  }

  function leave() {
    if (bitti) return
    bitti = true
    clearInterval(sayac)
    window.removeEventListener('online', internetGeldi)
    if (mesh) {
      mesh.leave() // bye gönderir, bağlantıları kapatır
      d.playBeep('leave')
    }
    mesh = null
    for (const id of [...sesler.keys()]) sesKaldir(id)
    hat?.close()
    hat = null
    state.speaking.clear()
  }

  function setMuted(b) {
    state.muted = state.listenOnly ? true : !!b // mikrofon yoksa hep susturulmuş
    kapiyiAyarla()
    yay('change')
  }

  // Sağırlaştır: gelen sesler (örgü + <audio>) ve kendi mikrofonumuz kapanır
  function setDeafened(b) {
    state.deafened = !!b
    mesh?.setDeafened(state.deafened)
    for (const a of sesler.values()) a.muted = state.deafened
    kapiyiAyarla()
    yay('change')
  }

  return {
    channelId,
    join,
    leave,
    getState: () => state,
    // olay: 'change' (durum/susturma/hata) ya da 'speaking' (konuşanlar kümesi)
    on(olay, cb) {
      dinleyiciler[olay].add(cb)
      return () => dinleyiciler[olay].delete(cb)
    },
    setMuted,
    toggleMute: () => setMuted(!state.muted),
    setDeafened,
    toggleDeafen: () => setDeafened(!state.deafened),
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
    // Mikrofon seviyesi 0..1 (kapıdan önce ölçülür; sesle algılama bunu okur)
    getLevel: () => hat?.getLevel() ?? 0,
    // Hoparlör seç (destekleyen tarayıcılarda); yeni gelen seslere de uygulanır
    setOutputDevice(id) {
      cikisCihazi = id || null
      for (const a of sesler.values()) a.setSinkId?.(cikisCihazi ?? '')?.catch?.(() => {})
    },
    // Gürültü engelleme anahtarı (ayarlar ekranı için)
    setNoiseSuppression(b) { hat?.setNoiseSuppression(b) },
  }
}
