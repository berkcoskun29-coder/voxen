// Testler için sahte WebRTC ve sahte yayın (broadcast) kanalı.
// Gerçek ağ yok: iki sahte RTCPeerConnection, SDP içindeki "a=x-fake:<no>" satırıyla birbirini bulur.
//
// Transceiver (gönder/al çifti) davranışı Chromium'a benzetildi, çünkü sıra hataları burada yakalanır:
//  - Teklif (offer) her transceiver için sırayla bir m-satırı içerir; mid'ler setLocalDescription'da atanır.
//  - Karşının teklifi uygulanırken (setRemoteDescription) her m-satırı için aynı türde, henüz
//    eşleşmemiş ve **addTrack ile oluşturulmuş** bir transceiver aranır (JSEP 5.10, Chromium da böyle).
//    addTransceiver ile önceden açılanlar EŞLEŞMEZ: yeni bir 'recvonly' transceiver listenin sonuna eklenir.
//  - Cevabın yönü = teklifin tersi ∩ bizim transceiver yönümüz. Yani cevaplayan bir görüntü
//    transceiver'ını 'sendrecv' yapmazsa sonradan replaceTrack ile görüntü gönderemez.
//  - ontrack: { track, streams, transceiver, receiver }. addTrack'siz izlerde streams boş gelir.
//  - replaceTrack(iz): yeniden pazarlık yok; yön göndermeye izin veriyorsa karşıdaki alıcı izi
//    "canlanır" (kaynak = iz, muted = false).

// Sahte ses izi ve akışı
export function fakeTrack(kind = 'audio') {
  return { kind, enabled: true, stop() { this.stopped = true } }
}
export function fakeStream(id = 'yerel') {
  const iz = fakeTrack()
  return { id, level: 0, getTracks: () => [iz], getAudioTracks: () => [iz] }
}

// Karşıdan gelen iz: medya akana kadar sessiz (muted). kaynak = karşının gönderdiği iz.
let izSayaci = 0
function uzakIz(kind) {
  return { kind, id: 'uzak-' + ++izSayaci, enabled: true, muted: true, kaynak: null }
}

const KODEK = {
  audio: ['a=rtpmap:111 opus/48000/2', 'a=fmtp:111 minptime=10;useinbandfec=1'],
  video: ['a=rtpmap:96 VP8/90000'],
}
const TERS = { sendrecv: 'sendrecv', sendonly: 'recvonly', recvonly: 'sendonly', inactive: 'inactive' }
const gonderir = (yon) => yon === 'sendrecv' || yon === 'sendonly'
const alir = (yon) => yon === 'sendrecv' || yon === 'recvonly'
// İki yönün kesişimi (ikisinin de izin verdiği)
function kesisim(a, b) {
  const g = gonderir(a) && gonderir(b)
  const al = alir(a) && alir(b)
  return g && al ? 'sendrecv' : g ? 'sendonly' : al ? 'recvonly' : 'inactive'
}

// SDP'yi m-satırlarına böl: [{ kind, mid, yon, metin }]
export function fakeSdpBolumleri(sdp) {
  return sdp.split('\r\nm=').slice(1).map((b) => ({
    kind: b.split(' ')[0],
    mid: /a=mid:(\S+)/.exec(b)?.[1] ?? null,
    yon: /a=(sendrecv|sendonly|recvonly|inactive)/.exec(b)?.[1] ?? 'sendrecv',
    metin: 'm=' + b,
  }))
}

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
      this.senders = [] // yalnız addTrack ile eklenen göndericiler (1. aşama testleri bunu okur)
      this.transceivers = [] // addTransceiver çağrılarının kaydı: { kind, init }
      this.txList = [] // gerçek transceiver listesi (getTransceivers), oluşturulma sırasıyla
      this.candidates = []
      this.setLocalSdps = []
      this.createOfferCalls = 0
      this.closed = false
      // Karşıya gidecek mikrofon sesi: karşı taraf ontrack'te bunu alır
      this.outStream = fakeStream('pc-' + this.no)
    }

    _txOlustur(kind, direction, track, stream, addTrackIle) {
      const pc = this
      const tx = {
        kind,
        mid: null,
        direction,
        currentDirection: null, // pazarlık sonucu kesinleşen yön
        addTrackIle, // Chromium yalnız bunları karşı teklifle eşleştirir
        receiver: { track: uzakIz(kind) },
        sender: {
          track: track ?? null,
          stream,
          params: { transactionId: 0, encodings: [{}] },
          txSayaci: 0, // gerçek tarayıcı gibi: eski/çift transactionId ile yazma reddedilir
          setCalls: [],
          replaceCalls: [],
          getParameters() { return JSON.parse(JSON.stringify(this.params)) },
          async setParameters(p) {
            if (p.transactionId !== this.params.transactionId) throw new DOMException('eski transactionId', 'InvalidModificationError')
            await Promise.resolve() // gerçekte yazma zaman alır: bu arada okuyan eski transactionId görür
            this.params = { ...p, transactionId: ++this.txSayaci }
            this.setCalls.push(p)
          },
          async replaceTrack(iz) {
            if (iz && iz.kind !== kind) throw new TypeError('tür uyuşmuyor')
            this.track = iz ?? null
            this.replaceCalls.push(iz ?? null)
            pc._medyaAkit(tx)
          },
        },
      }
      this.txList.push(tx)
      return tx
    }

    // Gönderilen iz varsa ve pazarlık edilen yön izin veriyorsa karşıdaki alıcı izini güncelle
    _medyaAkit(tx) {
      const karsi = this.partner?.txList.find((t) => t.mid != null && t.mid === tx.mid)
      if (!karsi || this.closed) return
      const akar = !!tx.sender.track && gonderir(tx.currentDirection)
      karsi.receiver.track.kaynak = akar ? tx.sender.track : null
      karsi.receiver.track.muted = !akar
    }

    addTrack(track, stream) {
      const tx = this._txOlustur(track.kind, 'sendrecv', track, stream, true)
      this.senders.push(tx.sender)
      return tx.sender
    }
    addTransceiver(kind, init = {}) {
      this.transceivers.push({ kind, init })
      return this._txOlustur(kind, init.direction ?? 'sendrecv', null, null, false)
    }
    getSenders() { return this.txList.map((t) => t.sender) }
    getTransceivers() { return this.txList }

    // Bir m-satırının metni
    _bolum(tx, mid, yon) {
      const msid = tx.sender.stream ? [`a=msid:${tx.sender.stream.id} iz`] : []
      return [`m=${tx.kind} 9 UDP/TLS/RTP/SAVPF`, `a=mid:${mid}`, `a=${yon}`, ...msid, ...KODEK[tx.kind]]
    }
    async createOffer() {
      this.createOfferCalls++
      // Henüz mid'i olmayanlara sıradaki numara verilir (setLocalDescription'da kesinleşir)
      let sonraki = this.txList.filter((t) => t.mid != null).length
      const satirlar = ['v=0', `a=x-fake:${this.no}`]
      for (const tx of this.txList) satirlar.push(...this._bolum(tx, tx.mid ?? String(sonraki++), tx.direction))
      return { type: 'offer', sdp: satirlar.join('\r\n') + '\r\n' }
    }
    async createAnswer() {
      if (this.signalingState !== 'have-remote-offer') throw new Error('InvalidStateError: teklif yok')
      const satirlar = ['v=0', `a=x-fake:${this.no}`]
      for (const b of fakeSdpBolumleri(this.remoteDescription.sdp)) {
        const tx = this.txList.find((t) => t.mid === b.mid)
        satirlar.push(...this._bolum(tx, b.mid, kesisim(TERS[b.yon], tx.direction)))
      }
      return { type: 'answer', sdp: satirlar.join('\r\n') + '\r\n' }
    }

    async setLocalDescription(d) {
      if (this.closed) throw new Error('InvalidStateError: kapalı')
      if (d.type === 'offer') this.signalingState = 'have-local-offer'
      else if (this.signalingState === 'have-remote-offer') this.signalingState = 'stable'
      else throw new Error('InvalidStateError: cevap için önce teklif gerekir')
      this.localDescription = d
      this.setLocalSdps.push(d.sdp)
      const bolumler = fakeSdpBolumleri(d.sdp)
      if (d.type === 'offer') {
        // Teklifteki sıra = transceiver sırası: mid'ler şimdi atanır
        bolumler.forEach((b, i) => { this.txList[i].mid = b.mid })
      } else {
        // Cevabımızla yön kesinleşti; takılı izler akmaya başlar
        for (const b of bolumler) this.txList.find((t) => t.mid === b.mid).currentDirection = b.yon
        for (const tx of this.txList) this._medyaAkit(tx)
      }
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
      const gelenler = []
      for (const b of fakeSdpBolumleri(d.sdp)) {
        let tx = this.txList.find((t) => t.mid === b.mid)
        if (!tx && d.type === 'offer') {
          // Chromium: yalnız addTrack ile açılmış, eşleşmemiş, aynı türde transceiver kullanılır
          tx = this.txList.find((t) => t.mid == null && t.kind === b.kind && t.addTrackIle)
          tx ??= this._txOlustur(b.kind, 'recvonly', null, null, false)
          tx.mid = b.mid
        }
        if (d.type === 'answer') tx.currentDirection = TERS[b.yon]
        // Karşı gönderiyorsa ve biz alıyorsak iz gelir
        if (gonderir(b.yon) && alir(tx.direction)) gelenler.push(tx)
      }
      for (const tx of gelenler) {
        const karsi = this.partner.txList.find((t) => t.mid === tx.mid)
        if (karsi?.sender.stream) {
          // Mikrofon gibi addTrack(iz, akış) ile gelen iz: akışıyla birlikte
          const akis = this.partner.outStream
          this.ontrack?.({ track: akis.getAudioTracks()[0], streams: [akis], transceiver: tx, receiver: tx.receiver })
        } else {
          this.ontrack?.({ track: tx.receiver.track, streams: [], transceiver: tx, receiver: tx.receiver })
        }
      }
      if (d.type === 'answer') for (const tx of this.txList) this._medyaAkit(tx)
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
