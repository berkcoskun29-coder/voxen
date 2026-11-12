// Eşler arası (P2P) tam örgü: kanaldaki herkes herkese DOĞRUDAN bağlanır.
// Sunucu sadece "tanışma" mesajlarını taşır (sinyal); ses hiçbir sunucudan geçmez.
//
// Sinyal mesajları ("voice:<kanalId>" konusunda yayın olarak):
//   hello  -> "Ben buradayım" (katılınca ve yeniden bağlanınca)
//   offer  -> bağlantı teklifi (SDP)       [to: kime]
//   answer -> teklife cevap (SDP)          [to: kime]
//   ice    -> ağ adresi adayı              [to: kime]
//   bye    -> "Ayrılıyorum"
// Her mesajda: from (gönderen kimliği) ve session (gönderenin bu katılıma özel rastgele numarası).
// offer/answer/ice ayrıca offerId taşır: hangi el sıkışmaya ait olduğu. Eski el sıkışmanın
// geç gelen cevabı/adayı yeni bağlantıya karışmasın diye eşleşmeyenler atılır.
//
// Kim teklif gönderir? shouldInitiate: kimliği küçük olan. Böylece iki taraf aynı anda aramaz.
import { tuneOpus, shouldInitiate } from './sdp.js'
import { rmsLevel, isSpeaking } from './level.js'
import { AUDIO_DEFAULTS } from '../config.js'

export const DISCONNECT_GRACE_MS = 10000 // 'disconnected' bu kadar sürerse eş düşürülür
export const CONNECT_TIMEOUT_MS = 15000 // bu sürede bağlanamazsak "bağlantı kurulamadı"
export const SPEAKING_POLL_MS = 100 // konuşan halkası kontrol aralığı
export const RESUBSCRIBE_DELAY_MS = 2000 // kanal kapanırsa bu kadar bekleyip yeniden abone ol
export const REJOIN_WATCHDOG_MS = 20000 // hata sonrası realtime-js bu sürede kendi yeniden katılamazsa kanalı biz yenileriz

const BOZUK = ['failed', 'disconnected', 'closed']

// Ses kalitesini izin verilen aralığa (32–128 kbps) sıkıştırır
export function clampBitrate(kbps) {
  const { minBitrateKbps: en_az, maxBitrateKbps: en_cok } = AUDIO_DEFAULTS
  const sayi = Number(kbps)
  if (!Number.isFinite(sayi)) return en_cok
  return Math.min(en_cok, Math.max(en_az, Math.round(sayi)))
}

// Bu katılıma özel rastgele numara (sayfa yenilenince değişir)
function rastgeleOturum() {
  return globalThis.crypto?.randomUUID?.() ?? String(Math.random()).slice(2)
}

export class PeerMesh {
  // signal(topic, onMessage, onStatus) -> { send(msg), close() }  (bkz. signal.js)
  // deps sadece testler içindir: RTCPeerConnection ve createLevelMeter yerine sahteleri verilebilir.
  constructor({ channelId, userId, localStream, iceServers, signal }, deps = {}) {
    this.channelId = channelId
    this.userId = userId
    this.localStream = localStream ?? null // mikrofon yoksa null: sadece dinleriz
    this.iceServers = iceServers
    this.signal = signal
    this.RTCPeerConnection = deps.RTCPeerConnection ?? globalThis.RTCPeerConnection
    this.createLevelMeter = deps.createLevelMeter ?? ((stream) => this._webAudioOlcer(stream))
    this.AudioContext = deps.AudioContext ?? globalThis.AudioContext

    this.oturum = rastgeleOturum()
    this.eslar = new Map() // userId -> eş kaydı (bkz. _esKur)
    this.basarisizlar = new Set() // şu an "bağlantı kurulamadı" durumundaki eşler
    this.teklifSayaci = 0
    this.dinleyiciler = new Map() // olay adı -> Set(cb)
    this.bitrateKbps = AUDIO_DEFAULTS.bitrateKbps
    this.deafened = false
    this.aktif = false
    this.sinyal = null
    this.jeton = null // geçerli aboneliğin kimliği: eski kanaldan gelen mesajları ayırt etmek için
    this.yenidenZamanlayici = 0 // CLOSED sonrası yeniden abone olma bekleyişi
    this.bekciZamanlayici = 0 // hata sonrası realtime-js'in kendi yeniden katılmasını bekleyiş
    this.konusmaSayaci = 0
  }

  // ---- Dışa açık yöntemler ----

  // Olay dinle: 'peer-joined' {userId, stream}, 'peer-left' {userId},
  // 'peer-speaking' {userId, speaking}, 'connect-failed' {userId}, 'ready' (sinyal kanalına bağlandı),
  // 'failed-change' (bağlanamayan eş sayısı değişti; bkz. failedPeerCount)
  on(olay, cb) {
    if (!this.dinleyiciler.has(olay)) this.dinleyiciler.set(olay, new Set())
    this.dinleyiciler.get(olay).add(cb)
    return () => this.dinleyiciler.get(olay)?.delete(cb)
  }

  join() {
    if (this.aktif) return
    this.aktif = true
    this._aboneOl()
    this.konusmaSayaci = setInterval(() => this._konusanlariKontrolEt(), SPEAKING_POLL_MS)
  }

  leave() {
    if (!this.aktif) return
    this._gonder({ type: 'bye' }) // önce haber ver, sonra kapat
    this.aktif = false
    clearInterval(this.konusmaSayaci)
    clearTimeout(this.yenidenZamanlayici)
    clearTimeout(this.bekciZamanlayici)
    this.yenidenZamanlayici = 0
    this.bekciZamanlayici = 0
    for (const id of [...this.eslar.keys()]) this._esiBirak(id)
    this.basarisizlar.clear()
    // close() bir Promise döner; aynı kanala yeniden katılım bunu signal.js içinde bekler
    this.sinyal?.close()
    this.sinyal = null
    this.jeton = null
    this._ctx?.close?.()
    this._ctx = null
  }

  // İnternet geri gelince (window 'online') çağrılır. Kanalı yıkmayız (realtime-js kendisi
  // yeniden bağlanır); sadece kendimizi tekrar duyururuz. Bağlanamadığımız eşler de yeniden denenir.
  reconnect() {
    if (!this.aktif) return
    this._gonder({ type: 'hello' })
  }

  // Şu an kaç eşle "doğrudan bağlantı kurulamadı" durumundayız
  failedPeerCount() {
    return this.basarisizlar.size
  }

  // Gönderilen ses kalitesi (kbps). 32–128 dışına çıkamaz. Uygulanan değeri döner.
  // Not: SDP'deki değer bir sonraki bağlantıda geçerli olur; mevcut bağlantılara setParameters ile uygulanır.
  setBitrate(kbps) {
    this.bitrateKbps = clampBitrate(kbps)
    for (const es of this.eslar.values()) if (es.katildi) this._bitHiziUygula(es)
    return this.bitrateKbps
  }

  // Sağırlaştır: gelen tüm sesler VE kendi mikrofonumuz kapanır.
  setDeafened(acik) {
    this.deafened = !!acik
    for (const iz of this.localStream?.getAudioTracks?.() ?? []) iz.enabled = !this.deafened
    for (const es of this.eslar.values()) this._gelenSesiAyarla(es)
  }

  // ---- Sinyal kanalı ----

  // Sinyal kanalına abone ol. onceki: varsa eski kanalın kapanış Promise'i. Önce o bitmeli;
  // yoksa realtime-js aynı konu için ESKİ kanal nesnesini geri verir ve abonelik hiç gerçekleşmez.
  async _aboneOl(onceki) {
    const jeton = {}
    this.jeton = jeton
    const gecerli = () => this.aktif && this.jeton === jeton
    try { await onceki } catch { /* kapanış hatası önemli değil */ }
    if (!gecerli()) return
    this.sinyal = this.signal(
      `voice:${this.channelId}`,
      (msg) => { if (gecerli()) this._mesajGeldi(msg) },
      (durum) => {
        if (!gecerli()) return
        if (durum === 'SUBSCRIBED') {
          // İlk katılma ya da realtime-js'in kendi yeniden katılması
          clearTimeout(this.bekciZamanlayici)
          this.bekciZamanlayici = 0
          this._yay('ready')
          this._gonder({ type: 'hello' }) // kendimizi (yeniden) duyur; bağlanamadıklarımız da tekrar denenir
        } else if (durum === 'CHANNEL_ERROR' || durum === 'TIMED_OUT') {
          // realtime-js kanalı kendisi yeniden katmaya çalışır (başarırsa yine SUBSCRIBED gelir).
          // Belli bir sürede olmazsa kanalı biz yıkıp taze açarız.
          if (!this.bekciZamanlayici) {
            this.bekciZamanlayici = setTimeout(() => {
              this.bekciZamanlayici = 0
              if (gecerli()) this._kanaliYenile()
            }, REJOIN_WATCHDOG_MS)
          }
        } else if (durum === 'CLOSED') {
          this._kanaliYenile() // kanal kapandı: kendiliğinden geri gelmez
        }
      },
    )
  }

  // Kanalı kapat; kapanışın bitmesini ve kısa bir süre bekle; TAZE bir kanalla yeniden abone ol
  _kanaliYenile() {
    if (this.yenidenZamanlayici) return
    clearTimeout(this.bekciZamanlayici)
    this.bekciZamanlayici = 0
    const kapanis = this.sinyal?.close()
    this.sinyal = null
    this.jeton = null // eski kanaldan gelenler artık yok sayılır
    this.yenidenZamanlayici = setTimeout(() => {
      this.yenidenZamanlayici = 0
      if (this.aktif) this._aboneOl(kapanis)
    }, RESUBSCRIBE_DELAY_MS)
  }

  _gonder(msg) {
    this.sinyal?.send({ ...msg, from: this.userId, session: this.oturum })
  }

  _mesajGeldi(m) {
    if (!m || m.from === this.userId) return // kendi mesajımız
    if (m.to && m.to !== this.userId) return // başkasına gönderilmiş
    if (m.type === 'hello') this._helloGeldi(m)
    else if (m.type === 'offer') this._teklifGeldi(m)
    else if (m.type === 'answer') this._cevapGeldi(m)
    else if (m.type === 'ice') this._adayGeldi(m)
    else if (m.type === 'bye') {
      this._esiBirak(m.from)
      if (this.basarisizlar.delete(m.from)) this._yay('failed-change')
    }
  }

  // ---- Tanışma ----

  _helloGeldi(m) {
    const es = this.eslar.get(m.from)
    if (es) {
      const yeniOturum = es.oturum !== m.session // sayfayı yenilemiş
      const bozuk = BOZUK.includes(es.pc.iceConnectionState)
      if (!yeniOturum && !bozuk) return // zaten bağlıyız ya da bağlanıyoruz
      this._esiBirak(m.from) // eski bağlantıyı kapat, baştan kur
    }
    // Not: bağlanamadığımız bir eşe kendiliğimizden hello göndermeyiz; hello ancak yeni bir
    // katılma/yeniden bağlanma döngüsünden gelir. Bu yüzden burada tekrar denemek sonsuz döngü yapmaz.
    if (shouldInitiate(this.userId, m.from)) {
      this._teklifGonder(m.from, m.session)
    } else if (!m.reply) {
      // Teklifi karşı taraf göndermeli: bizi tanısın diye ona özel bir hello cevabı yolla
      this._gonder({ type: 'hello', to: m.from, reply: true })
    }
  }

  async _teklifGonder(peerId, oturum) {
    const es = this._esKur(peerId, oturum, `${this.oturum}:${++this.teklifSayaci}`)
    try {
      const teklif = await es.pc.createOffer()
      if (!this._hala(es)) return
      // Bağlantı tarifini göndermeden önce Opus ayarlarını yaz (128 kbps, FEC)
      const ayarli = { type: 'offer', sdp: this._opusAyarla(teklif.sdp) }
      await es.pc.setLocalDescription(ayarli)
      if (!this._hala(es)) return
      this._gonder({ type: 'offer', to: peerId, sdp: ayarli.sdp, offerId: es.teklifNo })
    } catch {
      if (this._hala(es)) this._basarisiz(es)
    }
  }

  async _teklifGeldi(m) {
    if (this.eslar.has(m.from)) this._esiBirak(m.from) // yeni teklif: eskisini bırak
    const es = this._esKur(m.from, m.session, m.offerId)
    try {
      await es.pc.setRemoteDescription({ type: 'offer', sdp: m.sdp })
      if (!this._hala(es)) return
      this._bekleyenAdaylariEkle(es)
      const cevap = await es.pc.createAnswer()
      if (!this._hala(es)) return
      const ayarli = { type: 'answer', sdp: this._opusAyarla(cevap.sdp) }
      await es.pc.setLocalDescription(ayarli)
      if (!this._hala(es)) return
      this._gonder({ type: 'answer', to: m.from, sdp: ayarli.sdp, offerId: es.teklifNo })
    } catch {
      if (this._hala(es)) this._basarisiz(es)
    }
  }

  async _cevapGeldi(m) {
    const es = this.eslar.get(m.from)
    if (!es || es.uzakHazir) return
    if (m.offerId !== es.teklifNo) return // başka (eski) bir teklifin cevabı
    if (es.pc.signalingState !== 'have-local-offer') return // şu an cevap beklemiyoruz
    try {
      await es.pc.setRemoteDescription({ type: 'answer', sdp: m.sdp })
      if (!this._hala(es)) return
      this._bekleyenAdaylariEkle(es)
    } catch {
      if (this._hala(es)) this._basarisiz(es)
    }
  }

  _adayGeldi(m) {
    const es = this.eslar.get(m.from)
    if (!es || !m.candidate) return
    if (m.offerId !== es.teklifNo) return // başka (eski) bir el sıkışmaya ait
    // Karşının tarifi henüz kurulmadıysa adayı sıraya koy
    if (es.uzakHazir) es.pc.addIceCandidate(m.candidate).catch(() => {})
    else es.bekleyenAdaylar.push(m.candidate)
  }

  _bekleyenAdaylariEkle(es) {
    es.uzakHazir = true
    for (const c of es.bekleyenAdaylar.splice(0)) es.pc.addIceCandidate(c).catch(() => {})
  }

  _opusAyarla(sdp) {
    return tuneOpus(sdp, { bitrateKbps: this.bitrateKbps, fec: AUDIO_DEFAULTS.fec, stereo: false })
  }

  // ---- Eş kaydı ----

  _esKur(peerId, oturum, teklifNo) {
    // Bu eşle yeniden deniyoruz: "kurulamadı" durumundan çıkar (yine olmazsa tekrar girer)
    if (this.basarisizlar.delete(peerId)) this._yay('failed-change')
    const pc = new this.RTCPeerConnection({ iceServers: this.iceServers })
    const es = {
      id: peerId,
      pc,
      oturum, // karşı tarafın oturum numarası
      teklifNo, // bu el sıkışmanın numarası (offerId)
      katildi: false, // bir kez 'connected' oldu mu
      uzakHazir: false, // karşının tarifi (SDP) kuruldu mu
      bekleyenAdaylar: [],
      akis: null, // karşıdan gelen ses akışı
      olcer: null, // gelen sesin seviye ölçeri
      konusuyor: false,
      kopmaZamanlayici: 0,
      baglanmaZamanlayici: 0,
    }
    this.eslar.set(peerId, es)

    // Kendi sesimizi ekle; mikrofon yoksa sadece dinleyeceğimizi bildir
    const izler = this.localStream?.getAudioTracks?.() ?? []
    if (izler.length) for (const iz of izler) pc.addTrack(iz, this.localStream)
    else pc.addTransceiver('audio', { direction: 'recvonly' })

    pc.onicecandidate = (e) => {
      if (!e.candidate || !this._hala(es)) return
      const aday = typeof e.candidate.toJSON === 'function' ? e.candidate.toJSON() : e.candidate
      this._gonder({ type: 'ice', to: peerId, candidate: aday, offerId: es.teklifNo })
    }
    pc.ontrack = (e) => {
      if (!this._hala(es)) return
      es.akis = e.streams?.[0] ?? new MediaStream([e.track])
      this._gelenSesiAyarla(es)
    }
    pc.oniceconnectionstatechange = () => this._iceDegisti(es)
    es.baglanmaZamanlayici = setTimeout(() => {
      if (this._hala(es) && !es.katildi) this._basarisiz(es)
    }, CONNECT_TIMEOUT_MS)
    return es
  }

  _iceDegisti(es) {
    if (!this._hala(es)) return
    const durum = es.pc.iceConnectionState
    if (durum === 'connected' || durum === 'completed') {
      clearTimeout(es.kopmaZamanlayici)
      es.kopmaZamanlayici = 0
      if (es.katildi) return
      es.katildi = true
      if (this.basarisizlar.delete(es.id)) this._yay('failed-change')
      clearTimeout(es.baglanmaZamanlayici)
      this._bitHiziUygula(es)
      if (es.akis) es.olcer = this.createLevelMeter(es.akis)
      this._yay('peer-joined', { userId: es.id, stream: es.akis })
    } else if (durum === 'failed') {
      this._koptu(es)
    } else if (durum === 'disconnected' && !es.kopmaZamanlayici) {
      // Kısa kopmalar kendiliğinden düzelebilir: 10 sn bekle
      es.kopmaZamanlayici = setTimeout(() => {
        es.kopmaZamanlayici = 0
        if (this._hala(es)) this._koptu(es)
      }, DISCONNECT_GRACE_MS)
    }
  }

  // Bağlıyken koptu: eşi düşür ve yeniden tanışmak için ona hello gönder
  _koptu(es) {
    if (!es.katildi) return this._basarisiz(es)
    this._esiBirak(es.id)
    this._gonder({ type: 'hello', to: es.id })
  }

  // Hiç bağlanamadı (ör. iki taraf da sıkı NAT arkasında): bildir. Kendiliğimizden tekrar
  // denemeyiz; bir sonraki hello döngüsünde (yeniden bağlanma, internet geri gelme) denenir.
  _basarisiz(es) {
    this._esiBirak(es.id)
    this.basarisizlar.add(es.id)
    this._yay('connect-failed', { userId: es.id })
    this._yay('failed-change')
  }

  _esiBirak(id) {
    const es = this.eslar.get(id)
    if (!es) return
    this.eslar.delete(id)
    clearTimeout(es.kopmaZamanlayici)
    clearTimeout(es.baglanmaZamanlayici)
    es.olcer?.close()
    try { es.pc.close() } catch { /* zaten kapalı */ }
    if (es.katildi) this._yay('peer-left', { userId: id })
  }

  // Bu eş kaydı hâlâ geçerli mi? (bu arada ayrılmış ya da yenilenmiş olabilir)
  _hala(es) {
    return this.aktif && this.eslar.get(es.id) === es
  }

  // ---- Ses ----

  _gelenSesiAyarla(es) {
    for (const iz of es.akis?.getAudioTracks?.() ?? []) iz.enabled = !this.deafened
  }

  // Gönderilen sesin üst sınırı (bit/sn). Bazı tarayıcılarda desteklenmeyebilir: hatayı yut.
  _bitHiziUygula(es) {
    for (const gonderici of es.pc.getSenders?.() ?? []) {
      if (gonderici.track?.kind !== 'audio') continue
      try {
        const p = gonderici.getParameters()
        if (!p.encodings || p.encodings.length === 0) p.encodings = [{}]
        p.encodings[0].maxBitrate = this.bitrateKbps * 1000
        gonderici.setParameters(p).catch(() => {})
      } catch { /* desteklenmiyor */ }
    }
  }

  // 100 ms'de bir: her eşin gelen sesi eşiği geçiyor mu? Sadece değişince bildir.
  _konusanlariKontrolEt() {
    for (const es of this.eslar.values()) {
      if (!es.olcer) continue
      const konusuyor = !this.deafened && isSpeaking(es.olcer.getLevel())
      if (konusuyor !== es.konusuyor) {
        es.konusuyor = konusuyor
        this._yay('peer-speaking', { userId: es.id, speaking: konusuyor })
      }
    }
  }

  // Gerçek tarayıcıda gelen sesin seviyesini AnalyserNode ile ölçer
  _webAudioOlcer(stream) {
    const Ctx = this.AudioContext
    if (!Ctx) return { getLevel: () => 0, close() {} }
    this._ctx ??= new Ctx()
    // Bağlantı tıklamadan saniyeler sonra kurulur; bağlam 'suspended' başlayabilir.
    // Uyandırmazsak analyser hep sessizlik görür ve konuşan halkası yanmaz.
    if (this._ctx.state === 'suspended') Promise.resolve(this._ctx.resume?.()).catch(() => {})
    const kaynak = this._ctx.createMediaStreamSource(stream)
    const analiz = this._ctx.createAnalyser()
    analiz.fftSize = 1024
    kaynak.connect(analiz) // hoparlöre bağlanmaz; sadece ölçüm
    const tampon = new Float32Array(analiz.fftSize)
    return {
      getLevel() {
        analiz.getFloatTimeDomainData(tampon)
        return rmsLevel(tampon)
      },
      close() { kaynak.disconnect() },
    }
  }

  _yay(olay, veri) {
    for (const cb of this.dinleyiciler.get(olay) ?? []) {
      try { cb(veri) } catch (e) { console.error(e) }
    }
  }
}
