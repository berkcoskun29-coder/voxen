// @vitest-environment jsdom
// Susturma / sağırlaştırma simgeleri: ses paneli, kanal listesi, kullanıcı çubuğu
import { describe, it, expect } from 'vitest'
import { renderVoicePanel } from '../src/ui/voicePanel.js'
import { renderChannelList, voiceMembersByChannel } from '../src/ui/channelList.js'
import { mergeEntries } from '../src/presence/status.js'

const durum = (ek = {}) => ({ status: 'connected', muted: false, deafened: false, listenOnly: false, speaking: new Set(), ...ek })
const panelCiz = (state) => renderVoicePanel({ channelName: 'Lobi', state, handlers: {} })
const dugme = (p, yazi) => [...p.querySelectorAll('button')].find((b) => b.textContent === yazi)

describe('ses paneli simgeleri', () => {
  it('susturulmamışken mikrofon simgesi çizisiz, "Mikrofonu kapat"', () => {
    const b = dugme(panelCiz(durum()), 'Sustur')
    expect(b.querySelector('svg.icon')).not.toBeNull()
    expect(b.querySelector('svg.crossed')).toBeNull()
    expect(b.getAttribute('aria-label')).toBe('Mikrofonu kapat')
    expect(b.title).toBe('Mikrofonu kapat')
  })

  it('susturulunca simge çizili ve kırmızı, etiket "Mikrofonu aç"', () => {
    const b = dugme(panelCiz(durum({ muted: true })), 'Sustur')
    expect(b.querySelector('svg.crossed').getAttribute('stroke')).toBe('#e05b5b')
    expect(b.getAttribute('aria-label')).toBe('Mikrofonu aç')
  })

  it('sağırlaştırınca kulaklık çizili ("Sesi aç") ve mikrofon da çizili görünür', () => {
    const p = panelCiz(durum({ deafened: true }))
    const s = dugme(p, 'Sağırlaştır')
    expect(s.querySelector('svg.crossed')).not.toBeNull()
    expect(s.getAttribute('aria-label')).toBe('Sesi aç')
    expect(dugme(p, 'Sustur').querySelector('svg.crossed')).not.toBeNull()
    expect(dugme(p, 'Sustur').getAttribute('aria-label')).toBe('Mikrofonu kapat') // tıklama yalnız susturmayı değiştirir
    const normal = dugme(panelCiz(durum()), 'Sağırlaştır')
    expect(normal.getAttribute('aria-label')).toBe('Sesi kapat')
    expect(normal.querySelector('svg.crossed')).toBeNull()
  })
})

describe('kanal listesi simgeleri', () => {
  const profil = { id: 'u1', username: 'berk', color: '#5b7cfa' }
  const uyeler = [profil, { id: 'u2', username: 'ali', color: '#e05b5b' }, { id: 'u3', username: 'can', color: '#3be37a' }]
  const varlik = new Map([
    ['u1', { status: 'online', voiceChannelId: 'v', voiceMuted: false, voiceDeafened: false }],
    ['u2', { status: 'online', voiceChannelId: 'v', voiceMuted: true, voiceDeafened: false }],
    ['u3', { status: 'online', voiceChannelId: 'v', voiceMuted: true, voiceDeafened: true }], // sağır, susturmanın yerine geçer
  ])
  function ciz(ek = {}) {
    const panel = document.createElement('aside')
    renderChannelList(panel, {
      server: { id: 's', name: 'S', owner_id: 'u1' },
      channels: [{ id: 'v', name: 'Lobi', kind: 'voice', position: 1 }],
      profile: profil,
      voiceMembers: voiceMembersByChannel(uyeler, varlik),
      presence: varlik,
      handlers: {},
      ...ek,
    })
    return panel
  }

  it('her kişide durumuna uygun simge: yok / çizili mikrofon / çizili kulaklık', () => {
    const satirlar = [...ciz().querySelectorAll('.voice-member')]
    expect(satirlar.map((s) => s.querySelector('svg')?.dataset.state ?? null)).toEqual([null, 'muted', 'deafened'])
  })

  it('kendi kullanıcı çubuğumuzda da simge görünür (sesli kanaldayken)', () => {
    const voice = { channelName: 'Lobi', state: durum({ muted: true }), handlers: {} }
    expect(ciz({ voice }).querySelector('.user-bar svg[data-state="muted"]')).not.toBeNull()
    expect(ciz().querySelector('.user-bar svg')).toBeNull()
  })
})

describe('presence birleştirme', () => {
  it('çok sekmede susturma bilgisi, kanalı eşleşen girdiden alınır', () => {
    const m = mergeEntries([
      { status: 'online', voiceChannelId: null, voiceMuted: false },
      { status: 'online', voiceChannelId: 'v', voiceMuted: true, voiceDeafened: false },
    ])
    expect(m).toMatchObject({ voiceChannelId: 'v', voiceMuted: true, voiceDeafened: false })
    expect(mergeEntries([{ status: 'online' }])).toMatchObject({ voiceMuted: false, voiceDeafened: false })
  })
})
