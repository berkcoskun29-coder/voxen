// Eşler arası (P2P) tam örgü: kanaldaki herkes herkese DOĞRUDAN bağlanır.
// Sunucu sadece "tanışma" mesajlarını taşır (sinyal); ses hiçbir sunucudan geçmez.
//
// Sinyal mesajları ("voice:<kanalId>" ya da aramada "dm-voice:<arama id>" konusunda yayın olarak):
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
//
// GÖRÜNTÜ (2. aşama): hello ve offer "caps" (yetenekler) taşır: ['video'] = "kamera/ekran alabilirim".
// İki taraf da 'video' diyorsa bağlantıda 4 medya yuvası (slot) olur, SDP'de bu sırayla:
//   0 mic (mikrofon), 1 camera (kamera), 2 screen (ekran), 3 screenAudio (ekran sesi)
// Biri demiyorsa (eski v0.1.0 sürümü) yalnız mikrofon yuvası olur: 1. aşamadaki gibi.
// Görüntü yuvaları baştan açılır ama boştur. Kamera/ekran açılınca izi replaceTrack ile takarız;
// yeniden pazarlık (yeni offer) gerekmez.
import { tuneOpusSection, midOrder, shouldInitiate } from './sdp.js'
import { rmsLevel, isSpeaking } from './level.js'
import { AUDIO_DEFAULTS } from '../config.js'
import { computeVideoBudget } from './videoBudget.js'
import { UPLOAD_SECENEKLERI, DEFAULTS as AYAR_VARSAYILAN } from '../settings.js'

export const DISCONNECT_GRACE_MS = 10000 // 'disconnected' bu kadar sürerse eş düşürülür
export const CONNECT_TIMEOUT_MS = 15000 // bu sürede bağlanamazsak "bağlantı kurulamadı"
export const SPEAKING_POLL_MS = 100 // konuşan halkası kontrol aralığı
export const RESUBSCRIBE_DELAY_MS = 2000 // kanal kapanırsa bu kadar bekleyip yeniden abone ol
export const REJOIN_WATCHDOG_MS = 20000 // hata sonrası realtime-js bu sürede kendi yeniden katılamazsa kanalı biz yenileriz

const BOZUK = ['failed', 'disconnected', 'closed']

// Medya yuvaları, SDP'deki m-satırı sırasıyla. Bu sıra iki tarafta da aynı olmalı.
export const MEDIA_SLOTS = ['mic', 'camera', 'screen', 'screenAudio']
const GORUNTU_SLOTLARI = ['camera', 'screen', 'screenAudio'] // setLocalTrack ile takılabilenler
const SLOT_TURU = { camera: 'video', screen: 'video', screenAudio: 'audio' }
// Bu sürümün yetenekleri (hello/offer ile karşıya bildirilir)
export const MESH_CAPS = ['video']
// Ekran sesi: müzik/oyun sesi için çift kanal (stereo) ve yüksek kalite
const EKRAN_SESI_OPUS = { bitrateKbps: 128, fec: true, stereo: true }

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
  // caps: bu istemcinin yetenekleri (varsayılan MESH_CAPS; testler eski sürümü [] ile taklit eder)
  // topic: sinyal konusu (verilmezse "voice:<channelId>"; DM araması "dm-voice:<arama id>" verir)
  constructor({ channelId, topic, userId, localStream, iceServers, signal, caps = MESH_CAPS }, deps = {}) {
    this.channelId = channelId
    this.topic = topic ?? `voice:${channelId}`
    this.caps = [...caps]
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
    // Bizim açık kamera/ekran/ekran sesi izlerimiz. Yeni (ya da yeniden kurulan) her eşe takılır.
    this.yerelIzler = { camera: null, screen: null, screenAudio: null }
    this.uploadMbps = AYAR_VARSAYILAN.uploadMbps // görüntü bütçesinin kaynağı (ayarlardan gelir)
    this.ekranModu = 'net'
    this.odadaEkran = false // kanalda BAŞKA biri ekran paylaşıyor mu (voice_states'ten, uygulama bildirir)
    // İzinli eşler (grup araması): null = herkes (sesli kanal, bire bir arama). Set verilince listede olmayan
    // eşin bağlantısı kapanır ve sinyalleri (bye dışında) yok sayılır (gruptan çıkarılan eş kalamasın).
    this.izinliler = null
  }

  // ---- Dışa açık yöntemler ----

  // Olay dinle: 'peer-joined' {userId, stream}, 'peer-left' {userId},
  // 'peer-speaking' {userId, speaking}, 'connect-failed' {userId}, 'ready' (sinyal kanalına bağlandı),
  // 'failed-change' (bağlanamayan eş sayısı değişti; bkz. failedPeerCount),
  // 'peer-track' {peerId, slot, track} (karşının kamera/ekran/ekran sesi izi geldi; track null = kalktı).
  // 'peer-state' {userId, muted, deafened, camera, screen} (karşı tarafın sendState ile bildirdiği durum).
  //   Not: iz bağlantı kurulurken gelir ve karşı paylaşmıyorsa sessizdir (muted). Gösterip gizleme
  //   kararı presence + izin mute/unmute olaylarıyla verilir (arayüz görevi).
  on(olay, cb) {
    if (!this.dinleyiciler.has(olay)) this.dinleyiciler.set(olay, new Set())
    this.dinleyiciler.get(olay).add(cb)
    return () => this.dinleyiciler.get(olay)?.delete(cb)
  }

  // Grup araması: yalnız bu kişilerle bağlantı kurulur (null = herkes). Listeden çıkanın bağlantısı hemen
  // kapanır; yeni izin verilen ve henüz bağlı olmadığımız kişiye özel hello gider (onun hello'su biz
  // izin vermeden geldiyse yok sayılmıştı).
  setAllowedPeers(ids) {
    const eski = this.izinliler
    this.izinliler = ids == null ? null : new Set(ids)
    if (!this.izinliler) return
    for (const id of [...this.eslar.keys()]) if (!this.izinliler.has(id)) this._esiBirak(id)
    for (const id of [...this.basarisizlar]) {
      if (!this.izinliler.has(id) && this.basarisizlar.delete(id)) this._yay('failed-change')
    }
    if (!this.aktif) return
    for (const id of this.izinliler) {
      if (id === this.userId || this.eslar.has(id) || (eski && eski.has(id))) continue
      this._gonder({ type: 'hello', to: id })
    }
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

  // Kendi susturma/sağırlaştırma ve kamera/ekran durumumuzu karşıya bildir (DM araması kullanır; kanal yolu göndermez).
  // Karşıda 'peer-state' {userId, muted, deafened, camera, screen} olayı olur.
  // Eski sürüm bu mesaj türünü ya da yeni alanları yok sayar.
  sendState({ muted, deafened, camera = false, screen = false }) {
    if (!this.aktif) return
    this._gonder({ type: 'state', muted: !!muted, deafened: !!deafened, camera: !!camera, screen: !!screen })
  }

  // İnternet geri gelince (window 'online') çağrılır. Kanalı yıkmayız (realtime-js kendisi
  // yeniden bağlanır); sadece kendimizi tekrar duyururuz. Bağlanamadığımız eşler de yeniden denenir.
  reconnect() {
    if (!this.aktif) return
    this._gonder({ type: 'hello' })
  }

  // Kamera/ekran/ekran sesi izini aç (iz) ya da kapat (null). Bütün eşlere replaceTrack ile takılır;
  // yeniden pazarlık yapılmaz. Görüntü desteklemeyen (eski sürüm) eşlere hiçbir şey gitmez.
  async setLocalTrack(slot, track) {
    if (!GORUNTU_SLOTLARI.includes(slot)) throw new Error('Geçersiz yuva: ' + slot)
    this.yerelIzler[slot] = track ?? null
    const isler = []
    for (const es of this.eslar.values()) {
      const gonderici = es.gondericiler[slot]
      if (gonderici) isler.push(gonderici.replaceTrack(track ?? null).catch(() => {}))
    }
    await Promise.all(isler)
    if (slot !== 'screenAudio') this._butceyiYenile() // kamera/ekran aç-kapa: pay değişir
  }

  // Kanalda başka biri ekran paylaşmaya başladı/bıraktı: kameramızın bütçesi değişir (oda kuralı)
  setRoomScreenOn(b) {
    if (!!b === this.odadaEkran) return
    this.odadaEkran = !!b
    this._butceyiYenile()
  }

  // Ayarlardaki upload (5/10/20 Mbps) değişti. Geçersiz değer varsayılana düşer.
  setUploadMbps(mbps) {
    const yeni = UPLOAD_SECENEKLERI.includes(Number(mbps)) ? Number(mbps) : AYAR_VARSAYILAN.uploadMbps
    if (yeni === this.uploadMbps) return
    this.uploadMbps = yeni
    this._butceyiYenile()
  }

  // Bütçeyi bütün bağlı eşlerin göndericilerine yaz:
  //   ses (mikrofon) priority 'high', ekran sesi 'medium'; kamera/ekran 'low' + bit hızı + ölçek.
  // budget: computeVideoBudget sonucu; null olan kaynağın bit hızına dokunulmaz.
  applyVideoBudget(budget) {
    for (const es of this.eslar.values()) {
      if (!es.katildi) continue // henüz bağlanmadı: bağlanınca yeniden uygulanır
      const mikIzleri = this.localStream?.getAudioTracks?.() ?? []
      for (const g of es.pc.getSenders?.() ?? []) {
        if (mikIzleri.includes(g.track)) this._gondericiYaz(g, (k) => Object.assign(k, { priority: 'high', networkPriority: 'high' }))
      }
      for (const slot of GORUNTU_SLOTLARI) {
        const g = es.gondericiler[slot]
        if (!g) continue
        if (slot === 'screenAudio') {
          this._gondericiYaz(g, (k) => Object.assign(k, { priority: 'medium', networkPriority: 'medium' })) // ses değil "müzik": mikrofondan sonra
          continue
        }
        const b = budget?.[slot]
        const ayar = { priority: 'low', networkPriority: 'low' }
        if (b?.maxBitrate != null) {
          ayar.maxBitrate = b.maxBitrate * 1000
          ayar.scaleResolutionDownBy = b.scale
        }
        this._gondericiYaz(g, (k) => Object.assign(k, ayar))
      }
    }
  }

  // Bağlı (ve video destekleyen) eş sayısı = görüntü gönderdiğimiz izleyici sayısı
  _izleyiciSayisi() {
    let n = 0
    for (const es of this.eslar.values()) if (es.katildi && this._goruntuVarMi(es)) n++
    return n
  }

  // Güncel duruma göre bütçeyi hesapla ve uygula (eş katıl/ayrıl, kamera/ekran, upload değişimi)
  _butceyiYenile() {
    this.applyVideoBudget(computeVideoBudget({
      uploadMbps: this.uploadMbps,
      viewers: this._izleyiciSayisi(),
      cameraOn: !!this.yerelIzler.camera,
      screenOn: !!this.yerelIzler.screen,
      screenMode: this.ekranModu,
      // Oda kuralı: başkası ya da biz ekran paylaşıyorsak kamera küçülür
      roomScreenOn: this.odadaEkran || !!this.yerelIzler.screen,
    }))
  }

  // Göndericinin ilk kodlamasına yazma: aynı göndericiye yazmalar SIRAYLA yapılır. Aksi halde iki yazma
  // aynı getParameters() görüntüsünü (aynı transactionId) kullanır; ikincisi reddedilir ya da ilkini ezer.
  // degistir(kodlama) alanları değiştirir. Kodlama listesi pazarlıktan önce boş olabilir: atla
  // (bos: true ise tek boş kodlama açılır). Desteklemeyen tarayıcıda hata yutulur.
  _gondericiYaz(gonderici, degistir, { bos = false } = {}) {
    gonderici._sira = (gonderici._sira ?? Promise.resolve()).then(() => {
      const p = gonderici.getParameters()
      if (!p.encodings || p.encodings.length === 0) {
        if (!bos) return
        p.encodings = [{}]
      }
      degistir(p.encodings[0])
      return gonderici.setParameters(p)
    }).catch(() => {})
    return gonderici._sira
  }

  // Karşının bildirdiği yetenekler (ör. ['video']). Eski sürüm ya da tanımadığımız eş: []
  peerCaps(peerId) {
    return [...(this.eslar.get(peerId)?.yetenekler ?? [])]
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
      this.topic,
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
    // hello ve offer yeteneklerimizi de taşır (eski sürüm bu alanı yok sayar)
    const ek = msg.type === 'hello' || msg.type === 'offer' ? { caps: this.caps } : {}
    this.sinyal?.send({ ...msg, ...ek, from: this.userId, session: this.oturum })
  }

  _mesajGeldi(m) {
    if (!m || m.from === this.userId) return // kendi mesajımız
    if (m.to && m.to !== this.userId) return // başkasına gönderilmiş
    if (this.izinliler && !this.izinliler.has(m.from) && m.type !== 'bye') return // izinli değil (grup araması)
    if (m.type === 'hello') this._helloGeldi(m)
    else if (m.type === 'offer') this._teklifGeldi(m)
    else if (m.type === 'answer') this._cevapGeldi(m)
    else if (m.type === 'ice') this._adayGeldi(m)
    else if (m.type === 'state') this._yay('peer-state', { userId: m.from, muted: !!m.muted, deafened: !!m.deafened, camera: !!m.camera, screen: !!m.screen })
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
      this._teklifGonder(m.from, m.session, m.caps)
    } else if (!m.reply) {
      // Teklifi karşı taraf göndermeli: bizi tanısın diye ona özel bir hello cevabı yolla
      this._gonder({ type: 'hello', to: m.from, reply: true })
    }
  }

  async _teklifGonder(peerId, oturum, yetenekler) {
    const es = this._esKur(peerId, oturum, `${this.oturum}:${++this.teklifSayaci}`, yetenekler)
    // Teklif eden yuvaları kendisi açar. Sıra = SDP'deki m-satırı sırası = MEDIA_SLOTS.
    // (mikrofon yuvası _esKur'da açıldı; görüntü yuvaları yalnız iki taraf da destekliyorsa)
    if (this._goruntuVarMi(es)) {
      es.pc.addTransceiver('video', { direction: 'sendrecv' }) // camera
      es.pc.addTransceiver('video', { direction: 'sendrecv' }) // screen
      es.pc.addTransceiver('audio', { direction: 'sendrecv' }) // screenAudio
    }
    try {
      const teklif = await es.pc.createOffer()
      if (!this._hala(es)) return
      // Bağlantı tarifini göndermeden önce Opus ayarlarını yaz (128 kbps, FEC)
      const ayarli = { type: 'offer', sdp: this._opusAyarla(teklif.sdp) }
      await es.pc.setLocalDescription(ayarli)
      if (!this._hala(es)) return
      this._yerelIzleriTak(es) // mid'ler artık belli: açık kamera/ekran varsa tak
      this._gonder({ type: 'offer', to: peerId, sdp: ayarli.sdp, offerId: es.teklifNo })
    } catch {
      if (this._hala(es)) this._basarisiz(es)
    }
  }

  async _teklifGeldi(m) {
    if (this.eslar.has(m.from)) this._esiBirak(m.from) // yeni teklif: eskisini bırak
    const es = this._esKur(m.from, m.session, m.offerId, m.caps)
    try {
      await es.pc.setRemoteDescription({ type: 'offer', sdp: m.sdp })
      if (!this._hala(es)) return
      this._bekleyenAdaylariEkle(es)
      // Cevaplayan görüntü yuvalarını önceden AÇMAZ: tarayıcı (Chromium) addTransceiver ile
      // açılmışları karşı teklifle eşleştirmez; teklifteki her görüntü m-satırı için kendisi
      // 'recvonly' bir transceiver açar. Biz bunları mid sırasıyla bulup 'sendrecv' yaparız ki
      // sonradan replaceTrack ile biz de kamera/ekran gönderebilelim. Sonra açık izlerimizi takarız.
      if (this._goruntuVarMi(es)) this._yerelIzleriTak(es, { cevaplayan: true })
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

  // Opus ayarları m-satırı bazında: 0. satır mikrofon (seçilen kalite, tek kanal),
  // 3. satır (varsa) ekran sesi (128 kbps, stereo). Kamera/ekran satırlarında Opus yok.
  _opusAyarla(sdp) {
    const mik = { bitrateKbps: this.bitrateKbps, fec: AUDIO_DEFAULTS.fec, stereo: false }
    const sonuc = tuneOpusSection(sdp, MEDIA_SLOTS.indexOf('mic'), mik)
    return tuneOpusSection(sonuc, MEDIA_SLOTS.indexOf('screenAudio'), EKRAN_SESI_OPUS)
  }

  // Bu eşle görüntü yuvaları açılsın mı? İki taraf da 'video' yeteneğine sahipse.
  _goruntuVarMi(es) {
    return this.caps.includes('video') && es.yetenekler.includes('video')
  }

  // Bir transceiver'ın mid'ine göre yuvası: SDP'deki m-satırı sırası MEDIA_SLOTS sırasıdır.
  // (İki taraftaki tariflerde de sıra aynıdır; elimizde hangisi varsa ona bakarız.)
  _slotBul(pc, mid) {
    if (mid == null) return null
    const sdp = pc.remoteDescription?.sdp ?? pc.localDescription?.sdp
    const i = midOrder(sdp).indexOf(mid)
    return i >= 0 ? (MEDIA_SLOTS[i] ?? null) : null
  }

  // Görüntü yuvalarının göndericilerini bul (es.gondericiler) ve açık yerel izlerimizi tak.
  // cevaplayan: true ise bu yuvaları önce 'sendrecv' yap (bkz. _teklifGeldi).
  // Eş yeniden kurulduğunda da buradan geçilir: o anki kamera/ekran izleri yeni bağlantıya takılır.
  _yerelIzleriTak(es, { cevaplayan = false } = {}) {
    es.gondericiler = {}
    for (const t of es.pc.getTransceivers?.() ?? []) {
      const slot = this._slotBul(es.pc, t.mid)
      if (!GORUNTU_SLOTLARI.includes(slot)) continue // mikrofon ya da eşleşmemiş
      if (t.receiver?.track?.kind !== SLOT_TURU[slot]) continue // tür tutmuyor: dokunma
      if (cevaplayan) t.direction = 'sendrecv'
      es.gondericiler[slot] = t.sender
      const iz = this.yerelIzler[slot]
      if (iz) t.sender.replaceTrack(iz).catch(() => {})
    }
  }

  // ---- Eş kaydı ----

  // yetenekler: karşının hello/offer ile bildirdiği caps (eski sürümde yok -> [])
  _esKur(peerId, oturum, teklifNo, yetenekler) {
    // Bu eşle yeniden deniyoruz: "kurulamadı" durumundan çıkar (yine olmazsa tekrar girer)
    if (this.basarisizlar.delete(peerId)) this._yay('failed-change')
    const pc = new this.RTCPeerConnection({ iceServers: this.iceServers })
    const es = {
      id: peerId,
      pc,
      oturum, // karşı tarafın oturum numarası
      teklifNo, // bu el sıkışmanın numarası (offerId)
      yetenekler: Array.isArray(yetenekler) ? [...yetenekler] : [], // karşının caps'i
      gondericiler: {}, // görüntü yuvası -> RTCRtpSender (bkz. _yerelIzleriTak)
      gelenIzler: {}, // görüntü yuvası -> karşıdan gelen iz
      katildi: false, // bir kez 'connected' oldu mu
      uzakHazir: false, // karşının tarifi (SDP) kuruldu mu
      bekleyenAdaylar: [],
      akis: null, // karşıdan gelen MİKROFON akışı (yalnız mikrofon; konuşan halkası bunu ölçer)
      olcer: null, // gelen sesin seviye ölçeri
      konusuyor: false,
      kopmaZamanlayici: 0,
      baglanmaZamanlayici: 0,
    }
    this.eslar.set(peerId, es)

    // Kendi sesimizi ekle; mikrofon yoksa sadece dinleyeceğimizi bildir.
    // Bu, 0. yuva (mic): mikrofonsuzken de bir ses yuvası açılır ki teklifte sıra kaymasın.
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
      // Hangi yuvadan geldi? transceiver'ın mid'ine bak. (transceiver yoksa eski davranış: mikrofon)
      const slot = e.transceiver ? this._slotBul(pc, e.transceiver.mid) : 'mic'
      if (slot === 'mic') {
        es.akis = e.streams?.[0] ?? new MediaStream([e.track])
        this._gelenSesiAyarla(es)
      } else if (slot) {
        es.gelenIzler[slot] = e.track
        this._gelenSesiAyarla(es)
        this._yay('peer-track', { peerId: es.id, slot, track: e.track })
      }
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
      this._butceyiYenile() // yeni izleyici: pay yeniden bölünür
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
    // Bu eşin kamera/ekran izleri artık yok
    for (const slot of Object.keys(es.gelenIzler)) this._yay('peer-track', { peerId: id, slot, track: null })
    if (es.katildi) {
      this._yay('peer-left', { userId: id })
      this._butceyiYenile() // izleyen azaldı: kalanlara daha çok pay
    }
  }

  // Bu eş kaydı hâlâ geçerli mi? (bu arada ayrılmış ya da yenilenmiş olabilir)
  _hala(es) {
    return this.aktif && this.eslar.get(es.id) === es
  }

  // ---- Ses ----

  // Sağırken gelen sesler kapalı: mikrofon VE ekran sesi
  _gelenSesiAyarla(es) {
    for (const iz of es.akis?.getAudioTracks?.() ?? []) iz.enabled = !this.deafened
    if (es.gelenIzler.screenAudio) es.gelenIzler.screenAudio.enabled = !this.deafened
  }

  // Gönderilen MİKROFON sesinin üst sınırı (bit/sn). Ekran sesi göndericisine dokunmaz.
  // Bazı tarayıcılarda desteklenmeyebilir: hatayı yut.
  _bitHiziUygula(es) {
    const mikIzleri = this.localStream?.getAudioTracks?.() ?? []
    for (const gonderici of es.pc.getSenders?.() ?? []) {
      if (!mikIzleri.includes(gonderici.track)) continue
      const hiz = this.bitrateKbps * 1000
      this._gondericiYaz(gonderici, (k) => { k.maxBitrate = hiz }, { bos: true })
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
