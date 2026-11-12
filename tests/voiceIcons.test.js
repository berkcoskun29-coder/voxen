// @vitest-environment jsdom
// Susturma / sağırlaştırma simgeleri: ses paneli, kanal listesi, kullanıcı çubuğu
import { describe, it, expect } from 'vitest'
import { renderMuteButtons } from '../src/ui/voicePanel.js'
import { renderChannelList, voiceMembersByChannel } from '../src/ui/channelList.js'
import { mergeEntries } from '../src/presence/status.js'

const durum = (ek = {}) => ({ status: 'connected', muted: false, deafened: false, listenOnly: false, speaking: new Set(), ...ek })
// Sustur / Sağırlaştır artık kullanıcı çubuğunda (renderMuteButtons); ses panelinde yok
const panelCiz = (state) => { const k = document.createElement('div'); k.append(...renderMuteButtons(state)); return k }
const dugme = (p, yazi) => [...p.querySelectorAll('button')].find((b) => b.dataset.ad === yazi)

describe('çubuktaki Sustur / Sağırlaştır simgeleri', () => {
  it('susturulmamışken mikrofon simgesi çizisiz, "Mikrofonu kapat"', () => {
    const b = dugme(panelCiz(durum()), 'Sustur')
    expect(b.querySelector('svg.icon')).not.toBeNull()
    expect(b.querySelector('svg.crossed')).toBeNull()
    expect(b.dataset.tip).toBe('Mikrofonu kapat')
    expect(b.title).toBe('Mikrofonu kapat')
  })

  it('susturulunca simge çizili ve kırmızı, etiket "Mikrofonu aç"', () => {
    const b = dugme(panelCiz(durum({ muted: true })), 'Sustur')
    expect(b.querySelector('svg.crossed').getAttribute('stroke')).toBe('#e05b5b')
    expect(b.dataset.tip).toBe('Mikrofonu aç')
  })

  it('sağırlaştırınca kulaklık çizili ("Sesi aç") ve mikrofon da çizili görünür', () => {
    const p = panelCiz(durum({ deafened: true }))
    const s = dugme(p, 'Sağırlaştır')
    expect(s.querySelector('svg.crossed')).not.toBeNull()
    expect(s.dataset.tip).toBe('Sesi aç')
    expect(dugme(p, 'Sustur').querySelector('svg.crossed')).not.toBeNull()
    expect(dugme(p, 'Sustur').dataset.tip).toBe('Mikrofonu kapat') // tıklama yalnız susturmayı değiştirir
    const normal = dugme(panelCiz(durum()), 'Sağırlaştır')
    expect(normal.dataset.tip).toBe('Sesi kapat')
    expect(normal.querySelector('svg.crossed')).toBeNull()
  })
})

describe('kanal listesi simgeleri', () => {
  const profil = { id: 'u1', username: 'berk', color: '#5b7cfa' }
  const uyeler = [profil, { id: 'u2', username: 'ali', color: '#e05b5b' }, { id: 'u3', username: 'can', color: '#3be37a' }]
  const varlik = new Map([['u1', { status: 'online' }], ['u2', { status: 'online' }], ['u3', { status: 'online' }]])
  // Sesli durum artık voice_states tablosundan gelir
  const sesDurumlari = new Map([
    ['u1', { channelId: 'v', muted: false, deafened: false }],
    ['u2', { channelId: 'v', muted: true, deafened: false }],
    ['u3', { channelId: 'v', muted: true, deafened: true }], // sağır, susturmanın yerine geçer
  ])
  function ciz(ek = {}) {
    const panel = document.createElement('aside')
    renderChannelList(panel, {
      server: { id: 's', name: 'S', owner_id: 'u1' },
      channels: [{ id: 'v', name: 'Lobi', kind: 'voice', position: 1 }],
      profile: profil,
      voiceMembers: voiceMembersByChannel(uyeler, sesDurumlari, varlik),
      voiceStates: sesDurumlari,
      handlers: {},
      ...ek,
    })
    return panel
  }

  it('her kişide durumuna uygun simge: yok / çizili mikrofon / çizili kulaklık', () => {
    const satirlar = [...ciz().querySelectorAll('.voice-member')]
    expect(satirlar.map((s) => s.querySelector('svg')?.dataset.state ?? null)).toEqual([null, 'muted', 'deafened'])
  })

  it('kendi kullanıcı çubuğumuzda durum Sustur düğmesinde görünür (ayrı ikinci simge yok)', () => {
    const voice = { channelName: 'Lobi', state: durum({ muted: true }), handlers: {} }
    const bar = ciz({ voice }).querySelector('.user-bar')
    expect(bar.querySelector('[data-ad="Sustur"] svg.crossed')).not.toBeNull()
    expect(bar.querySelector('svg[data-state]')).toBeNull()
  })
})

describe('presence birleştirme', () => {
  it('varlık artık yalnız durum ve yazı taşır (sesli durum voice_states tablosunda)', () => {
    const m = mergeEntries([
      { status: 'online', statusText: 'a', voiceChannelId: 'v', voiceMuted: true },
      { status: 'idle', statusText: 'b' },
    ])
    expect(m).toEqual({ status: 'online', statusText: 'a' })
  })
})
