// @vitest-environment jsdom
// Tek aktif ses (Görev 2, DM araması): sesli kanal ve DM araması birbirini kapatır.
// Uygulama appVoice üzerinden sürülür (arama arayüzü sonraki görevlerde).
import { describe, it, expect, vi, beforeEach } from 'vitest'

const fake = vi.hoisted(() => ({}))

vi.mock('../src/lib/supabase.js', () => {
  fake.rows = {}
  fake.vsOps = [] // voice_states yazmaları: ['upsert', satır] | ['delete', filtre]
  fake.from = vi.fn((tablo) => {
    const satirlar = fake.rows[tablo] ?? []
    const filtre = {}
    let islem = 'select'
    let deger = null
    let tek = false
    const zincir = {
      select: () => zincir, eq: (k, v) => { filtre[k] = v; return zincir }, lt: () => zincir, in: () => zincir, is: () => zincir,
      order: () => zincir, limit: () => zincir,
      maybeSingle: () => { tek = true; return zincir },
      upsert: (v) => { islem = 'upsert'; deger = v; return zincir },
      insert: () => zincir,
      delete: () => { islem = 'delete'; return zincir },
      then: async (res) => {
        if (tablo !== 'voice_states') return res({ data: satirlar, error: null })
        if (islem === 'upsert') fake.vsOps.push(['upsert', deger])
        else if (islem === 'delete') fake.vsOps.push(['delete', { ...filtre }])
        return res({ data: tek ? null : [], error: null })
      },
    }
    return zincir
  })
  // Açık sinyal kanalları (voice:<id> ve dm-voice:<id>); bırakılınca listeden düşer
  fake.acikKonular = []
  fake.tumKonular = []
  fake.channel = vi.fn((ad) => {
    const k = {
      ad,
      on: (_t, f, cb) => {
        if (ad === 'presence:voxen') fake.syncCb = cb
        return k
      },
      subscribe: (cb) => {
        if (ad === 'presence:voxen' || ad.startsWith('messages-all:') || ad.startsWith('dm-messages-all:')) cb?.('SUBSCRIBED')
        return k
      },
      send: () => Promise.resolve(),
      track: () => {},
      untrack: () => {},
      presenceState: () => ({}),
    }
    if (ad.startsWith('voice:') || ad.startsWith('dm-voice:')) {
      fake.acikKonular.push(ad)
      fake.tumKonular.push(ad)
    }
    return k
  })
  return {
    supabase: {
      // Yalnız end_dm_call bu testlerin konusu; diğer RPC'ler (arkadaş, DM listesi) boş döner
      rpc: vi.fn(),
      from: (...a) => fake.from(...a),
      channel: (...a) => fake.channel(...a),
      removeChannel: (k) => {
        const i = fake.acikKonular.indexOf(k?.ad)
        if (i >= 0) fake.acikKonular.splice(i, 1)
      },
    },
  }
})

// Sahte mikrofon ve ses hattı: kaç mikrofonun aynı anda açık olduğunu sayarız
vi.mock('../src/voice/session.js', async (asil) => {
  const m = await asil()
  const { fakeStream } = await import('./fakes/webrtc.js')
  return {
    ...m,
    createVoiceSession: (o) => {
      const s = m.createVoiceSession({
        ...o,
        deps: {
          openMic: async () => {
            const mik = fakeStream('mik')
            fake.mikrofonlar.push(mik)
            return mik
          },
          createVoicePipeline: async (mik) => ({
            outputStream: fakeStream('hat'),
            setGate() {},
            getLevel: () => 0,
            setNoiseSuppression() {},
            close() { mik.getTracks().forEach((t) => t.stop()) },
          }),
          playBeep: () => {},
          getNoiseSuppressionPref: () => true,
        },
      })
      fake.oturumlar.push(s)
      return s
    },
  }
})

vi.mock('../src/data/typing.js', () => ({
  typingTiming: { sendEveryMs: 3000, expireMs: 5000 },
  joinTyping: () => ({ typing() {}, stopped() {}, clear() {}, leave: async () => {} }),
}))

import { startApp, stopApp, appTiming, appVoice } from '../src/ui/app.js'
import { supabase } from '../src/lib/supabase.js'
import { presenceLimits } from '../src/presence/presence.js'
import { voiceStateTiming, resetVoiceStateWriter } from '../src/data/voiceStates.js'
import { getSettings, updateSettings } from '../src/settings.js'

presenceLimits.maxCalls = Infinity
presenceLimits.gapMs = 0
voiceStateTiming.coalesceMs = 0
appTiming.staleWindowGraceMs = 0

const profil = { id: 'u1', username: 'berk', color: '#5b7cfa' }
const thread = { id: 't1', other: { id: 'u2', username: 'ayla', color: '#e05b5b' } }
const bosalt = async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0)) }
const acikMikrofon = () => fake.mikrofonlar.filter((m) => !m.getTracks()[0].stopped).length
const bitirmeler = () => supabase.rpc.mock.calls.filter(([ad]) => ad === 'end_dm_call').map(([, a]) => a)
const kanalaTikla = (ad) =>
  [...document.querySelectorAll('.channel-item')].find((b) => b.textContent.includes(ad)).click()
const dugme = (ad) => [...document.querySelectorAll('.user-bar button')].find((b) => b.dataset.ad === ad)
const toastlar = () => [...document.querySelectorAll('.toast')].map((t) => t.textContent)

beforeEach(async () => {
  window.dispatchEvent(new Event('pagehide'))
  stopApp()
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape' }))
  await bosalt()
  supabase.rpc.mockReset()
  supabase.rpc.mockImplementation((ad) => (ad === 'end_dm_call' ? Promise.resolve({ data: null, error: null }) : undefined))
  fake.rows = {
    servers: [{ id: 's1', name: 'S', owner_id: 'u1', invite_code: 'k' }],
    channels: [
      { id: 'a', server_id: 's1', name: 'genel', kind: 'text', position: 0 },
      { id: 'v', server_id: 's1', name: 'Lobi', kind: 'voice', position: 1 },
    ],
  }
  fake.vsOps = []
  fake.acikKonular = []
  fake.tumKonular = []
  fake.mikrofonlar = []
  fake.oturumlar = []
  resetVoiceStateWriter()
  localStorage.clear()
  sessionStorage.clear()
  location.hash = ''
  document.body.innerHTML = '<div id="app"></div>'
  // Bas-konuş tuşu sorulmasın (pencere tıklamaları yutar)
  updateSettings({ mode: 'vad' })
})

async function uygulamayiAc() {
  await startApp(document.querySelector('#app'), profil)
  await bosalt()
}

describe('appVoice: DM aramasına girmek', () => {
  it('uygulama kapalıyken bir şey yapmaz', () => {
    stopApp()
    expect(appVoice.aramayaGir({ id: 'c1' }, thread)).toBeNull()
    expect(appVoice.aktifSes()).toBeNull()
    expect(() => appVoice.aramadanCik('hangup')).not.toThrow()
  })

  it('aramaya girince dm-voice:<id> konusuna katılır; voice_states yazılmaz', async () => {
    await uygulamayiAc()
    const oturum = appVoice.aramayaGir({ id: 'c1' }, thread)
    await bosalt()
    expect(oturum.topic).toBe('dm-voice:c1')
    expect(fake.acikKonular).toEqual(['dm-voice:c1'])
    expect(appVoice.aktifSes()).toMatchObject({ tur: 'arama', call: { id: 'c1' }, thread, oturum })
    expect(acikMikrofon()).toBe(1)
    expect(fake.vsOps).toEqual([]) // arama kanal değildir: voice_states'e dokunulmaz
    // Aynı aramaya tekrar girmek yeni oturum açmaz
    expect(appVoice.aramayaGir({ id: 'c1' }, thread)).toBe(oturum)
    expect(fake.oturumlar).toHaveLength(1)
  })

  it('aramadanCik(reason): oturum kapanır, kanal bırakılır, mikrofon durur, endCall çağrılır', async () => {
    await uygulamayiAc()
    appVoice.aramayaGir({ id: 'c1' }, thread)
    await bosalt()
    appVoice.aramadanCik('hangup')
    await bosalt()
    expect(appVoice.aktifSes()).toBeNull()
    expect(fake.acikKonular).toEqual([])
    expect(acikMikrofon()).toBe(0)
    expect(bitirmeler()).toEqual([{ id: 'c1', reason: 'hangup' }])
    expect(fake.vsOps).toEqual([])
  })

  it('aramadanCik(null): yalnız yerelde kapanır (karşı taraf zaten bitirdi), endCall yok', async () => {
    await uygulamayiAc()
    appVoice.aramayaGir({ id: 'c1' }, thread)
    await bosalt()
    appVoice.aramadanCik(null)
    await bosalt()
    expect(fake.acikKonular).toEqual([])
    expect(bitirmeler()).toEqual([])
  })

  it('sesli kanaldayken aramaya girince önce kanaldan çıkılır ve bildirim çıkar; tek mikrofon', async () => {
    await uygulamayiAc()
    kanalaTikla('Lobi')
    await bosalt()
    expect(appVoice.aktifSes()).toMatchObject({ tur: 'kanal', channelId: 'v', serverId: 's1', channelName: 'Lobi' })
    expect(fake.acikKonular).toEqual(['voice:v'])
    expect(acikMikrofon()).toBe(1)
    appVoice.aramayaGir({ id: 'c1' }, thread)
    await bosalt()
    expect(toastlar()).toContain('Sesli kanaldan ayrıldın.')
    expect(fake.acikKonular).toEqual(['dm-voice:c1'])
    expect(acikMikrofon()).toBe(1)
    expect(fake.oturumlar[0].getState().speaking.size).toBe(0)
    expect(fake.vsOps.at(-1)).toEqual(['delete', expect.objectContaining({ user_id: 'u1' })]) // kanal satırı silindi
    expect(document.querySelector('.voice-panel')).toBeNull() // kanalın ses paneli kapandı
    expect(appVoice.aktifSes().tur).toBe('arama')
  })

  it('aramadayken sesli kanala girince arama hangup ile biter, sonra kanala girilir', async () => {
    await uygulamayiAc()
    appVoice.aramayaGir({ id: 'c1' }, thread)
    await bosalt()
    kanalaTikla('Lobi')
    await bosalt()
    expect(bitirmeler()).toEqual([{ id: 'c1', reason: 'hangup' }])
    expect(fake.acikKonular).toEqual(['voice:v'])
    expect(acikMikrofon()).toBe(1)
    expect(appVoice.aktifSes()).toMatchObject({ tur: 'kanal', channelId: 'v' })
    expect(fake.vsOps.at(-1)).toEqual(['upsert', expect.objectContaining({ channel_id: 'v' })])
    expect(toastlar()).not.toContain('Sesli kanaldan ayrıldın.')
  })

  it('başka bir aramaya girmek eskisini hangup ile bitirir', async () => {
    await uygulamayiAc()
    appVoice.aramayaGir({ id: 'c1' }, thread)
    await bosalt()
    appVoice.aramayaGir({ id: 'c2' }, thread)
    await bosalt()
    expect(bitirmeler()).toEqual([{ id: 'c1', reason: 'hangup' }])
    expect(fake.acikKonular).toEqual(['dm-voice:c2'])
    expect(acikMikrofon()).toBe(1)
  })

  it('mikrofon açılırken kanaldan aramaya geçilse de aynı anda tek mikrofon açık kalır', async () => {
    await uygulamayiAc()
    kanalaTikla('Lobi')
    // kanal oturumu kurulur kurulmaz (mikrofon/hat daha hazır değilken) aramaya geç
    for (let i = 0; i < 50 && fake.oturumlar.length === 0; i++) await Promise.resolve()
    expect(fake.oturumlar).toHaveLength(1)
    expect(fake.oturumlar[0].getState().status).toBe('connecting')
    appVoice.aramayaGir({ id: 'c1' }, thread)
    await bosalt()
    expect(fake.mikrofonlar).toHaveLength(2) // kanalınki açılıp hemen kapandı
    expect(acikMikrofon()).toBe(1)
    expect(fake.acikKonular).toEqual(['dm-voice:c1'])
  })

  it('sesli kanal katılımı beklerken aramaya girilirse o katılım iptal olur', async () => {
    await uygulamayiAc()
    kanalaTikla('Lobi') // başka pencere denetimi (getMyVoiceState) bekleniyor
    appVoice.aramayaGir({ id: 'c1' }, thread)
    await bosalt()
    expect(appVoice.aktifSes().tur).toBe('arama')
    expect(fake.tumKonular).toEqual(['dm-voice:c1'])
    expect(bitirmeler()).toEqual([])
  })

  it('kullanıcı çubuğundaki Sustur / Sağırlaştır aramanın oturumuna uygulanır (voice_states yok)', async () => {
    await uygulamayiAc()
    const oturum = appVoice.aramayaGir({ id: 'c1' }, thread)
    await bosalt()
    expect(oturum.getState().listenOnly).toBe(false)
    dugme('Sustur').click()
    expect(oturum.getState().muted).toBe(true)
    expect(getSettings().muted).toBe(true)
    expect(dugme('Sustur').getAttribute('aria-pressed')).toBe('true')
    dugme('Sağırlaştır').click()
    expect(oturum.getState().deafened).toBe(true)
    expect(dugme('Sağırlaştır').getAttribute('aria-pressed')).toBe('true')
    dugme('Sustur').click() // sağırken Sustur: ikisi de kalkar
    expect(oturum.getState()).toMatchObject({ muted: false, deafened: false })
    await bosalt()
    expect(fake.vsOps).toEqual([])
  })

  it('aramaya kayıtlı Sustur tercihiyle girilir', async () => {
    updateSettings({ muted: true })
    await uygulamayiAc()
    const oturum = appVoice.aramayaGir({ id: 'c1' }, thread)
    expect(oturum.getState().muted).toBe(true)
  })

  it('"Aramada · Ad" satırı girişte çıkar, sunucu/Ana sayfa geçişinde kalır; satıra tıklayınca DM açılır; Kapat aramayı bitirir', async () => {
    await uygulamayiAc()
    expect(document.querySelector('.call-row')).toBeNull()
    appVoice.aramayaGir({ id: 'c1' }, thread)
    await bosalt()
    expect(document.querySelector('.call-row .voice-info').textContent).toBe('Aramada · ayla')
    document.querySelector('.rail-home').click() // Ana sayfaya geç: arama sürer, satır kalır
    await bosalt()
    expect(document.querySelector('.rail-home.selected')).not.toBeNull()
    expect(document.querySelector('.call-row .voice-info').textContent).toBe('Aramada · ayla')
    expect(document.querySelector('.call-row').nextElementSibling.classList.contains('user-bar')).toBe(true)
    document.querySelector('.call-row .call-open').click()
    await bosalt()
    expect(document.querySelector('.msg-composer, textarea')).not.toBeNull() // DM sohbeti açıldı
    expect(document.querySelector('.call-row')).not.toBeNull()
    document.querySelector('.call-row button.leave').click()
    await bosalt()
    expect(document.querySelector('.call-row')).toBeNull()
    expect(appVoice.aktifSes()).toBeNull()
    expect(bitirmeler()).toEqual([{ id: 'c1', reason: 'hangup' }])
  })

  it("aramada görüntü bölmesi kurulur; yalnız aramanın DM'i açıkken görünür; arama bitince kalkar", async () => {
    await uygulamayiAc()
    appVoice.aramayaGir({ id: 'c1' }, thread)
    await bosalt()
    const alan = document.querySelector('.video-host')
    expect(alan.querySelector('.video-pane')).not.toBeNull()
    expect(alan.hidden).toBe(true) // sunucu görünümündeyiz: aramanın DM'i açık değil
    document.querySelector('.call-row .call-open').click() // DM açılır
    await bosalt()
    expect(alan.hidden).toBe(false)
    document.querySelector('.call-row button.leave').click()
    await bosalt()
    expect(alan.querySelector('.video-pane')).toBeNull()
    expect(alan.hidden).toBe(false) // sesli kanalın bölmesi için yeniden açık
  })

  it('sayfa kapanırken ve uygulama dururken arama biter', async () => {
    await uygulamayiAc()
    appVoice.aramayaGir({ id: 'c1' }, thread)
    await bosalt()
    window.dispatchEvent(new Event('pagehide'))
    await bosalt()
    expect(fake.acikKonular).toEqual([])
    expect(bitirmeler()).toEqual([{ id: 'c1', reason: 'hangup' }])
    appVoice.aramayaGir({ id: 'c2' }, thread)
    await bosalt()
    stopApp()
    await bosalt()
    expect(fake.acikKonular).toEqual([])
    expect(acikMikrofon()).toBe(0)
    expect(bitirmeler().at(-1)).toEqual({ id: 'c2', reason: 'hangup' })
    expect(appVoice.aktifSes()).toBeNull()
  })
})
