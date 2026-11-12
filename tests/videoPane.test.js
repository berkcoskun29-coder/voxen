// @vitest-environment jsdom
// Görüntü bölmesi: kutucuklar (presence + iz mute/unmute), odak/tam ekran, ekran sesi kaydırıcısı,
// "Görüntüyü gizle", eski sürüm notu, kanal listesindeki 📷/🖥 simgeleri ve oturumdaki ekran sesi.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../src/lib/supabase.js', () => ({ supabase: { channel: vi.fn(), removeChannel: vi.fn() } }))

import { mountVideoPane, buildVideoPeers, OLD_VERSION_NOTE, VIDEO_PANE_KEY } from '../src/ui/videoPane.js'
import { renderChannelList, voiceMembersByChannel } from '../src/ui/channelList.js'
import { createVoiceSession } from '../src/voice/session.js'
import { fakeStream } from './fakes/webrtc.js'

// Sahte iz: mute/unmute olayları gönderebilen (EventTarget)
function iz(kind = 'video', muted = false) {
  const t = new EventTarget()
  t.kind = kind
  t.muted = muted
  t.sustur = () => { t.muted = true; t.dispatchEvent(new Event('mute')) }
  t.ac = () => { t.muted = false; t.dispatchEvent(new Event('unmute')) }
  return t
}

// Bölmenin istediği eş listesi (buildVideoPeers'ın döndüğü biçim)
function es(ek = {}) {
  return { id: 'u2', name: 'ali', self: false, camera: false, screen: false, tracks: {}, speaking: false, videoCap: true, hidden: false, volume: 1, ...ek }
}

let esler, kap, bolme, gizle, ses, okuma
function kur(liste) {
  okuma = 0
  esler = liste
  kap = document.createElement('div')
  document.body.appendChild(kap)
  gizle = vi.fn()
  ses = vi.fn()
  bolme = mountVideoPane(kap, { getPeers: () => { okuma++; return esler }, onHide: gizle, onVolume: ses })
  bolme.update()
  return bolme
}
const kutular = () => [...kap.querySelectorAll('.video-tile')]

beforeEach(() => {
  document.body.innerHTML = ''
  localStorage.clear()
  window.HTMLMediaElement.prototype.play = vi.fn(() => Promise.resolve())
  globalThis.MediaStream = class { constructor(izler) { this.izler = izler } getTracks() { return this.izler } }
})

describe('görüntü bölmesi', () => {
  it('kimsede görüntü yoksa bölme gizli', () => {
    kur([es()])
    expect(kap.querySelector('.video-pane').hidden).toBe(true)
  })

  it('presence kamera açık + iz geldi -> kutucuk görünür', () => {
    const k = iz()
    kur([es({ camera: true, tracks: { camera: k } })])
    expect(kap.querySelector('.video-pane').hidden).toBe(false)
    expect(kutular()).toHaveLength(1)
    const v = kutular()[0].querySelector('video')
    expect(v.srcObject.getTracks()).toEqual([k])
    expect(v.muted).toBe(true)
    expect(v.autoplay).toBe(true)
  })

  it('iz sessizken (muted) kutucuk yok; unmute gelince görünür', () => {
    const k = iz('video', true)
    kur([es({ camera: true, tracks: { camera: k } })])
    expect(kutular()).toHaveLength(0)
    k.ac()
    expect(kutular()).toHaveLength(1)
  })

  it('iz mute olayı -> kutucuk gizlenir (donmuş kare kalmaz)', () => {
    const k = iz()
    kur([es({ camera: true, tracks: { camera: k } })])
    const v = kutular()[0].querySelector('video')
    k.sustur()
    expect(kutular()).toHaveLength(0)
    expect(v.srcObject).toBeNull()
  })

  it('presence kapalıysa iz olsa da kutucuk yok', () => {
    kur([es({ camera: false, tracks: { camera: iz() } })])
    expect(kutular()).toHaveLength(0)
  })

  it('ekran büyük, kamera küçük; tıklayınca odaklanan büyür', () => {
    kur([es({ camera: true, screen: true, tracks: { camera: iz(), screen: iz() } })])
    const sahne = kap.querySelector('.video-stage')
    const serit = kap.querySelector('.video-strip')
    expect(sahne.querySelector('.video-tile.screen')).not.toBeNull()
    expect(serit.querySelector('.video-tile.camera')).not.toBeNull()
    serit.querySelector('.video-tile.camera').click()
    expect(sahne.querySelector('.video-tile.camera')).not.toBeNull()
    expect(serit.querySelector('.video-tile.screen')).not.toBeNull()
  })

  it('çift tıklayınca tam ekran istenir; reddedilirse hata fırlamaz', async () => {
    kur([es({ screen: true, tracks: { screen: iz() } })])
    const kutu = kutular()[0]
    kutu.requestFullscreen = vi.fn(() => Promise.reject(new Error('izin yok')))
    kutu.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    expect(kutu.requestFullscreen).toHaveBeenCalled()
    await Promise.resolve()
  })

  describe('tam ekran', () => {
    let tam = null
    beforeEach(() => {
      tam = null
      Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => tam })
      document.exitFullscreen = vi.fn(() => Promise.reject(new Error('yok')))
    })
    afterEach(() => { tam = null }) // sonraki testler tam ekransız başlasın

    it('çift tıklama tam ekrandayken çıkar (requestFullscreen tekrar çağrılmaz)', async () => {
      kur([es({ screen: true, tracks: { screen: iz() } })])
      const kutu = kutular()[0]
      kutu.requestFullscreen = vi.fn(() => Promise.resolve())
      tam = kutu
      kutu.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
      expect(document.exitFullscreen).toHaveBeenCalled()
      expect(kutu.requestFullscreen).not.toHaveBeenCalled()
      await Promise.resolve()
    })

    it('tam ekrandayken tek tıklama odağı değiştirmez', () => {
      kur([es({ camera: true, screen: true, tracks: { camera: iz(), screen: iz() } })])
      const kamera = kap.querySelector('.video-tile.camera')
      tam = kamera
      kamera.click()
      expect(kap.querySelector('.video-strip').contains(kamera)).toBe(true)
      expect(kamera.classList.contains('focused')).toBe(false)
    })

    it('güncellemeler tam ekrandaki kutucuğu yerinden oynatmaz', () => {
      const a = es({ id: 'u2', name: 'ali', camera: true, tracks: { camera: iz() } })
      const b = es({ id: 'u3', name: 'can', camera: true, tracks: { camera: iz() } })
      kur([a, b])
      const serit = kap.querySelector('.video-strip')
      const [ka, kb] = [...serit.children]
      tam = kb
      const tasima = vi.spyOn(serit, 'insertBefore')
      esler = [b, a] // sıra değişti
      bolme.update()
      expect(tasima.mock.calls.some(([e]) => e === kb)).toBe(false)
      expect(serit.contains(kb)).toBe(true)
      expect(serit.contains(ka)).toBe(true)
      // Yeni bir ekran paylaşımı gelince de kamera tam ekrandan düşmez
      esler = [b, es({ id: 'u2', name: 'ali', camera: true, screen: true, tracks: { camera: a.tracks.camera, screen: iz() } })]
      bolme.update()
      expect(tasima.mock.calls.some(([e]) => e === kb)).toBe(false)
    })
  })

  it('eski sürüm notları liste değişmedikçe yeniden kurulmaz', () => {
    kur([es({ screen: true, tracks: { screen: iz() } }), es({ id: 'u3', name: 'can', videoCap: false })])
    const not = kap.querySelector('.video-note')
    bolme.update()
    expect(kap.querySelector('.video-note')).toBe(not)
    esler = [...esler, es({ id: 'u4', name: 'deniz', videoCap: false })]
    bolme.update()
    expect(kap.querySelectorAll('.video-note')).toHaveLength(2)
  })

  it('konuşanın kutucuğunda yeşil çerçeve sınıfı', () => {
    kur([es({ camera: true, tracks: { camera: iz() }, speaking: true })])
    expect(kutular()[0].classList.contains('speaking')).toBe(true)
    esler = [es({ camera: true, tracks: esler[0].tracks, speaking: false })]
    bolme.update()
    expect(kutular()[0].classList.contains('speaking')).toBe(false)
  })

  it('kendi önizlememiz "Sen" etiketli; kamera aynalı, ekran aynasız', () => {
    kur([es({ id: 'u1', self: true, name: 'berk', camera: true, screen: true, tracks: { camera: iz(), screen: iz() } })])
    const kamera = kap.querySelector('.video-tile.camera')
    const ekran = kap.querySelector('.video-tile.screen')
    expect(kamera.querySelector('.video-name').textContent).toBe('Sen')
    expect(kamera.querySelector('video').classList.contains('mirror')).toBe(true)
    expect(ekran.querySelector('video').classList.contains('mirror')).toBe(false)
    // Kendimiz için gizle/kaydırıcı yok
    expect(kap.querySelector('.video-control')).toBeNull()
  })

  it('kullanıcı adı textContent ile yazılır (HTML çalışmaz)', () => {
    kur([es({ name: '<b>kötü</b>', screen: true, tracks: { screen: iz() } })])
    const ad = kutular()[0].querySelector('.video-name')
    expect(ad.textContent).toBe('<b>kötü</b>')
    expect(kap.querySelector('b')).toBeNull()
  })

  it('kaydırıcı onVolume ile ses seviyesini bildirir (0..1)', () => {
    kur([es({ screen: true, tracks: { screen: iz() }, volume: 0.5 })])
    const k = kap.querySelector('.video-control input[type="range"]')
    expect(k.value).toBe('50')
    k.value = '30'
    k.dispatchEvent(new Event('input'))
    expect(ses).toHaveBeenCalledWith('u2', 0.3)
  })

  it('"Görüntüyü gizle" onHide çağırır; gizliyken kutucuk yok, düğme "Görüntüyü göster"', () => {
    kur([es({ screen: true, tracks: { screen: iz() } })])
    const d = () => kap.querySelector('.video-control button')
    expect(d().textContent).toBe('Görüntüyü gizle')
    d().click()
    expect(gizle).toHaveBeenCalledWith('u2', true)
    esler = [es({ screen: true, tracks: esler[0].tracks, hidden: true })]
    bolme.update()
    expect(kutular()).toHaveLength(0)
    expect(kap.querySelector('.video-pane').hidden).toBe(false) // geri açabilmek için bölme görünür kalır
    expect(d().textContent).toBe('Görüntüyü göster')
    d().click()
    expect(gizle).toHaveBeenCalledWith('u2', false)
  })

  it('görüntü cap\'i olmayan eş için güncelleme notu', () => {
    kur([es({ screen: true, tracks: { screen: iz() } }), es({ id: 'u3', name: 'can', videoCap: false })])
    const not = kap.querySelector('.video-notes')
    expect(not.textContent).toContain('can: ' + OLD_VERSION_NOTE)
    expect(not.textContent).not.toContain('ali')
  })

  it('başlıktan açılıp kapanır; durum hatırlanır, ilk görüntü gelince kendiliğinden açılır', () => {
    const k = iz('video', true)
    kur([es({ camera: true, tracks: { camera: k } })])
    const govde = kap.querySelector('.video-pane-body')
    const dugme = kap.querySelector('.video-pane-toggle')
    dugme.click()
    expect(govde.hidden).toBe(true)
    expect(localStorage.getItem(VIDEO_PANE_KEY)).toBe('1')
    dugme.click()
    expect(govde.hidden).toBe(false)
    dugme.click()
    // Görüntü yokken (presence kapalı) bölme gizli; sonra biri açınca bölme kendiliğinden açılır
    esler = [es({ camera: false })]
    bolme.update()
    esler = [es({ camera: true, tracks: { camera: iz() } })]
    bolme.update()
    expect(govde.hidden).toBe(false)
  })

  it('dispose: iz dinleyicileri bırakılır, video boşaltılır, bölme kalkar', () => {
    const k = iz()
    kur([es({ camera: true, tracks: { camera: k } })])
    const v = kutular()[0].querySelector('video')
    bolme.dispose()
    const once = okuma
    expect(v.srcObject).toBeNull()
    expect(kap.querySelector('.video-pane')).toBeNull()
    k.sustur() // dinleyici kalmadıysa hata ya da yeniden çizim olmaz
    expect(okuma).toBe(once)
  })
})

describe('buildVideoPeers', () => {
  it('kendimizi yerel izlerle, karşıyı sesli durum + uzak izlerle birleştirir', () => {
    const kamera = iz()
    const ekran = iz()
    const oturum = {
      getState: () => ({ camera: true, screen: false, speaking: new Set(['u2']) }),
      getLocalTracks: () => ({ camera: kamera, screen: null }),
      getRemoteTracks: (id) => (id === 'u2' ? { screen: ekran } : {}),
      peerHasVideo: (id) => (id === 'u2' ? true : id === 'u3' ? false : null),
      getScreenAudio: (id) => (id === 'u2' ? { volume: 0.4, hidden: true } : { volume: 1, hidden: false }),
    }
    const voiceStates = new Map([['u2', { screen: true, camera: false }], ['u3', {}]])
    const liste = buildVideoPeers({
      self: { id: 'u1', username: 'berk' },
      members: [{ id: 'u2', username: 'ali' }, { id: 'u3', username: 'can' }],
      voiceStates,
      session: oturum,
    })
    expect(liste[0]).toMatchObject({ id: 'u1', self: true, camera: true, screen: false, tracks: { camera: kamera } })
    expect(liste[1]).toMatchObject({ id: 'u2', name: 'ali', screen: true, camera: false, speaking: true, videoCap: true, hidden: true, volume: 0.4 })
    expect(liste[1].tracks.screen).toBe(ekran)
    expect(liste[2]).toMatchObject({ id: 'u3', videoCap: false })
  })
})

// ---- Oturum: ekran sesi kendi <audio> elemanından çalar ----

class FakeMesh {
  constructor() { this.d = {}; FakeMesh.son = this }
  on(ad, cb) { (this.d[ad] ??= []).push(cb); return () => {} }
  emit(ad, veri) { for (const cb of this.d[ad] ?? []) cb(veri) }
  join() {}
  leave() {}
  setDeafened(b) { this.deafened = b }
  setBitrate(k) { return k }
  failedPeerCount() { return 0 }
  peerCaps(id) { return id === 'eski' ? [] : ['video'] }
  setLocalTrack() { return Promise.resolve() }
}

async function oturumKur() {
  const o = createVoiceSession({
    channelId: 'v1',
    userId: 'ben',
    deps: {
      openMic: async () => fakeStream('mik'),
      createVoicePipeline: async () => ({ outputStream: fakeStream('hat'), setGate() {}, getLevel: () => 0, close() {}, setNoiseSuppression() {} }),
      createMesh: () => new FakeMesh(),
      playBeep: () => {},
      getNoiseSuppressionPref: () => true,
    },
  })
  await o.join()
  return o
}
const ekranSesi = () => document.querySelector('audio[data-screen-audio="u2"]')

describe('oturum: ekran sesi', () => {
  it('gelen ekran sesi ayrı bir <audio> ile çalar; ayrılınca kalkar', async () => {
    const o = await oturumKur()
    const t = iz('audio')
    const tracks = vi.fn()
    o.on('tracks', tracks)
    FakeMesh.son.emit('peer-track', { peerId: 'u2', slot: 'screenAudio', track: t })
    expect(ekranSesi().srcObject.getTracks()).toEqual([t])
    expect(o.getRemoteTracks('u2').screenAudio).toBe(t)
    expect(tracks).toHaveBeenCalled()
    FakeMesh.son.emit('peer-track', { peerId: 'u2', slot: 'screenAudio', track: null })
    expect(ekranSesi()).toBeNull()
    FakeMesh.son.emit('peer-track', { peerId: 'u2', slot: 'screenAudio', track: iz('audio') })
    o.leave()
    expect(document.querySelectorAll('audio')).toHaveLength(0)
  })

  it('kaydırıcı ses seviyesini ayarlıyor', async () => {
    const o = await oturumKur()
    FakeMesh.son.emit('peer-track', { peerId: 'u2', slot: 'screenAudio', track: iz('audio') })
    o.setScreenVolume('u2', 0.25)
    expect(ekranSesi().volume).toBeCloseTo(0.25)
    expect(o.getScreenAudio('u2')).toEqual({ volume: 0.25, hidden: false })
    o.setScreenVolume('u2', 7) // aralık dışı sıkıştırılır
    expect(ekranSesi().volume).toBe(1)
  })

  it('gizle -> ekran sesi volume 0; göster -> eski seviye', async () => {
    const o = await oturumKur()
    FakeMesh.son.emit('peer-track', { peerId: 'u2', slot: 'screenAudio', track: iz('audio') })
    o.setScreenVolume('u2', 0.6)
    o.setScreenHidden('u2', true)
    expect(ekranSesi().volume).toBe(0)
    o.setScreenHidden('u2', false)
    expect(ekranSesi().volume).toBeCloseTo(0.6)
  })

  it('sağırlaştırınca ekran sesi susuyor', async () => {
    const o = await oturumKur()
    FakeMesh.son.emit('peer-track', { peerId: 'u2', slot: 'screenAudio', track: iz('audio') })
    expect(ekranSesi().muted).toBe(false)
    o.setDeafened(true)
    expect(ekranSesi().muted).toBe(true)
    // Sağırken gelen yeni ekran sesi de sessiz başlar
    FakeMesh.son.emit('peer-track', { peerId: 'u2', slot: 'screenAudio', track: iz('audio') })
    expect(ekranSesi().muted).toBe(true)
    o.setDeafened(false)
    expect(ekranSesi().muted).toBe(false)
  })

  it('peerHasVideo: bağlı eşin cap\'i; bağlı olmayan için null', async () => {
    const o = await oturumKur()
    expect(o.peerHasVideo('eski')).toBeNull()
    FakeMesh.son.emit('peer-joined', { userId: 'eski', stream: null })
    FakeMesh.son.emit('peer-joined', { userId: 'u2', stream: null })
    expect(o.peerHasVideo('eski')).toBe(false)
    expect(o.peerHasVideo('u2')).toBe(true)
    FakeMesh.son.emit('peer-left', { userId: 'eski' })
    expect(o.peerHasVideo('eski')).toBeNull()
  })

  it('getLocalTracks açık kamera izini verir', async () => {
    const kameraIzi = iz()
    kameraIzi.stop = () => {}
    const o = createVoiceSession({
      channelId: 'v1', userId: 'ben',
      deps: {
        openMic: async () => fakeStream('mik'),
        createVoicePipeline: async () => ({ outputStream: fakeStream('hat'), setGate() {}, getLevel: () => 0, close() {}, setNoiseSuppression() {} }),
        createMesh: () => new FakeMesh(),
        openCamera: async () => kameraIzi,
        playBeep: () => {},
        getNoiseSuppressionPref: () => true,
      },
    })
    await o.join()
    expect(o.getLocalTracks()).toEqual({ camera: null, screen: null })
    await o.setCamera(true)
    expect(o.getLocalTracks().camera).toBe(kameraIzi)
    o.leave()
  })
})

describe('kanal listesi: kamera/ekran simgeleri', () => {
  it('camera / screen açık olanın yanında 📷 / 🖥 simgesi', () => {
    const uyeler = [{ id: 'u1', username: 'berk', color: '#5b7cfa' }, { id: 'u2', username: 'ali', color: '#e05b5b' }]
    const varlik = new Map([['u1', { status: 'online' }], ['u2', { status: 'online' }]])
    const sesDurumlari = new Map([
      ['u1', { channelId: 'v', camera: true, screen: true, muted: true }],
      ['u2', { channelId: 'v' }],
    ])
    const panel = document.createElement('aside')
    renderChannelList(panel, {
      server: { id: 's', name: 'S', owner_id: 'u1' },
      channels: [{ id: 'v', name: 'Lobi', kind: 'voice', position: 1 }],
      profile: uyeler[0],
      voiceMembers: voiceMembersByChannel(uyeler, sesDurumlari, varlik),
      voiceStates: sesDurumlari,
      handlers: {},
    })
    const [birinci, ikinci] = panel.querySelectorAll('.voice-member')
    expect([...birinci.querySelectorAll('svg')].map((s) => s.dataset.state)).toEqual(['muted', 'camera', 'screen'])
    expect(ikinci.querySelector('svg')).toBeNull()
  })
})
