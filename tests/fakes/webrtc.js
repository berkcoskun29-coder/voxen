// Testler için sahte WebRTC ve sahte yayın (broadcast) kanalı.
// Gerçek ağ yok: iki sahte RTCPeerConnection, SDP içindeki "a=x-fake:<no>" satırıyla birbirini bulur.

// Sahte ses izi ve akışı
export function fakeTrack() {
  return { kind: 'audio', enabled: true, stop() { this.stopped = true } }
}
export function fakeStream(id = 'yerel') {
  const iz = fakeTrack()
  return { id, level: 0, getTracks: () => [iz], getAudioTracks: () => [iz] }
}

const OPUS_SDP = 'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=rtpmap:111 opus/48000/2\r\na=fmtp:111 minptime=10\r\n'

// net.autoConnect false olursa bağlantı kendiliğinden 'connected' olmaz (test elle durum verir).
export function createNet() {
  const net = { pcs: [], autoConnect: true }

  class FakeRTCPeerConnection {
    constructor(config) {
      this.config = config
      this.no = net.pcs.length
      net.pcs.push(this)
      this.iceConnectionState = 'new'
      this.signalingState = 'stable' // gerçek tarayıcı gibi: tarif sırası denetlenir
      this.localDescription = null
      this.remoteDescription = null
      this.senders = []
      this.transceivers = []
      this.candidates = []
      this.setLocalSdps = []
      this.closed = false
      // Karşıya gidecek ses: karşı taraf ontrack'te bunu alır
      this.outStream = fakeStream('pc-' + this.no)
    }
    addTrack(track, stream) {
      const sender = {
        track,
        stream,
        params: { encodings: [{}] },
        setCalls: [],
        getParameters() { return JSON.parse(JSON.stringify(this.params)) },
        async setParameters(p) { this.params = p; this.setCalls.push(p) },
      }
      this.senders.push(sender)
      return sender
    }
    getSenders() { return this.senders }
    addTransceiver(kind, init) { this.transceivers.push({ kind, init }) }
    async createOffer() { return { type: 'offer', sdp: OPUS_SDP + `a=x-fake:${this.no}\r\n` } }
    async createAnswer() { return { type: 'answer', sdp: OPUS_SDP + `a=x-fake:${this.no}\r\n` } }
    async setLocalDescription(d) {
      if (this.closed) throw new Error('InvalidStateError: kapalı')
      if (d.type === 'offer') this.signalingState = 'have-local-offer'
      else if (this.signalingState === 'have-remote-offer') this.signalingState = 'stable'
      else throw new Error('InvalidStateError: cevap için önce teklif gerekir')
      this.localDescription = d
      this.setLocalSdps.push(d.sdp)
      // Aday (ICE candidate) üret: biri gerçek, sonra "bitti" (null)
      Promise.resolve().then(() => {
        if (this.closed) return
        this.onicecandidate?.({ candidate: { candidate: 'cand-' + this.no, sdpMid: '0' } })
        this.onicecandidate?.({ candidate: null })
      })
      this._dene()
    }
    async setRemoteDescription(d) {
      if (this.closed) throw new Error('InvalidStateError: kapalı')
      // Cevap sadece 'have-local-offer' durumunda kabul edilir; teklif sadece 'stable' iken
      if (d.type === 'answer') {
        if (this.signalingState !== 'have-local-offer') throw new Error('InvalidStateError: beklenmeyen cevap')
        this.signalingState = 'stable'
      } else {
        if (this.signalingState !== 'stable') throw new Error('InvalidStateError: beklenmeyen teklif')
        this.signalingState = 'have-remote-offer'
      }
      this.remoteDescription = d
      const no = Number(/a=x-fake:(\d+)/.exec(d.sdp)[1])
      this.partner = net.pcs[no]
      const akis = this.partner.outStream
      this.ontrack?.({ track: akis.getAudioTracks()[0], streams: [akis] })
      this._dene()
    }
    async addIceCandidate(c) { this.candidates.push(c) }
    // Her iki tarafın da iki tarifi hazırsa bağlan
    _dene() {
      const p = this.partner
      if (!net.autoConnect || !p) return
      const hazir = (x) => x.localDescription && x.remoteDescription && !x.closed
      if (hazir(this) && hazir(p) && this.iceConnectionState === 'new') {
        this._setIce('connected')
        p._setIce('connected')
      }
    }
    _setIce(durum) {
      this.iceConnectionState = durum
      this.oniceconnectionstatechange?.()
    }
    close() { this.closed = true; this.iceConnectionState = 'closed'; this.signalingState = 'closed' }
  }

  net.RTCPeerConnection = FakeRTCPeerConnection
  return net
}

// Sahte Supabase yayın kanalı. Her abonelik kendi konusuna (topic) gelen mesajları alır.
// signal(topic, onMessage, onStatus) -> { send(msg), close() }  (PeerMesh'in beklediği biçim)
// bus.hold(msg) true dönerse mesaj teslim edilmez, bus.held'e konur (geciken mesaj denemesi için).
// bus.closeGate bir Promise ise close() o çözülene kadar bitmez (Supabase removeChannel gibi).
export function createBus() {
  const bus = { subs: [], sent: [], held: [], hold: null, closeGate: null }
  bus.signal = (topic, onMessage, onStatus) => {
    const sub = { topic, onMessage, onStatus, open: true }
    bus.subs.push(sub)
    Promise.resolve().then(() => { if (sub.open) onStatus('SUBSCRIBED') })
    return {
      send(msg) {
        if (!sub.open) return
        bus.sent.push({ topic, msg })
        for (const s of bus.subs) {
          if (s === sub || !s.open || s.topic !== topic) continue
          const kopya = structuredClone(msg) // gerçek ağ gibi: nesne paylaşılmaz
          if (bus.hold?.(kopya)) { bus.held.push({ sub: s, msg: kopya }); continue }
          Promise.resolve().then(() => { if (s.open) s.onMessage(kopya) })
        }
      },
      close() {
        sub.open = false
        sub.closing = true
        return Promise.resolve(bus.closeGate).then(() => { sub.closing = false; sub.closedDone = true })
      },
    }
  }
  // Tutulan mesajları şimdi teslim et
  bus.release = () => {
    for (const { sub, msg } of bus.held.splice(0)) if (sub.open) sub.onMessage(msg)
  }
  // Bir aboneliğe hata durumu gönder (internet koptu gibi)
  bus.fail = (sub, durum = 'CHANNEL_ERROR') => sub.onStatus(durum)
  return bus
}

// Sahte seviye ölçer: akışın "level" alanını okur
export const fakeLevelMeter = (stream) => ({ getLevel: () => stream.level ?? 0, close() { this.closed = true } })
