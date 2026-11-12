// @vitest-environment jsdom
// Kanal paneli: sesli kanalın altında içerideki kişiler, konuşan halkası ve ses paneli.
import { describe, it, expect } from 'vitest'
import { renderChannelList, updateSpeakingRings, voiceMembersByChannel } from '../src/ui/channelList.js'

const profil = { id: 'u1', username: 'berk', color: '#5b7cfa' }
const kanallar = [
  { id: 'a', name: 'genel', kind: 'text', position: 0 },
  { id: 'v', name: 'Lobi', kind: 'voice', position: 1 },
  { id: 'w', name: 'Oyun', kind: 'voice', position: 2 },
]
const uyeler = [profil, { id: 'u2', username: 'ali', color: '#e05b5b' }, { id: 'u3', username: 'can', color: '#3be37a' }]
const varlik = new Map([
  ['u1', { status: 'online', voiceChannelId: 'v' }],
  ['u2', { status: 'online', voiceChannelId: 'v' }],
  ['u3', { status: 'idle', voiceChannelId: null }],
])

function ciz(ek = {}) {
  const panel = document.createElement('aside')
  renderChannelList(panel, {
    server: { id: 's', name: 'S', owner_id: 'u1' },
    channels: kanallar,
    profile: profil,
    selectedChannelId: 'a',
    voiceMembers: voiceMembersByChannel(uyeler, varlik),
    handlers: {},
    ...ek,
  })
  return panel
}

describe('sesli kanaldaki kişiler', () => {
  it('voiceMembersByChannel varlıktaki voiceChannelId ile gruplar', () => {
    const g = voiceMembersByChannel(uyeler, varlik)
    expect(g.get('v').map((p) => p.username)).toEqual(['berk', 'ali'])
    expect(g.has('w')).toBe(false)
  })

  it('kişiler kendi kanalının altında ad ve baş harfle listelenir', () => {
    const panel = ciz()
    const lobi = panel.querySelector('[data-voice-channel="v"]')
    const kisiler = [...lobi.querySelectorAll('.voice-member')]
    expect(kisiler.map((k) => k.querySelector('.voice-member-name').textContent)).toEqual(['berk', 'ali'])
    expect(kisiler[1].querySelector('.voice-avatar').textContent).toBe('A')
    expect(panel.querySelector('[data-voice-channel="w"]').querySelectorAll('.voice-member')).toHaveLength(0)
  })

  it('konuşanın avatarında halka olur; updateSpeakingRings yeniden çizmeden günceller', () => {
    const panel = ciz({ speaking: new Set(['u2']) })
    const av = (id) => panel.querySelector(`.voice-avatar[data-user-id="${id}"]`)
    expect(av('u2').classList.contains('speaking')).toBe(true)
    expect(av('u1').classList.contains('speaking')).toBe(false)
    updateSpeakingRings(panel, new Set(['u1']))
    expect(av('u1').classList.contains('speaking')).toBe(true)
    expect(av('u2').classList.contains('speaking')).toBe(false)
  })

  it('sesli kanaldayken ses paneli kullanıcı çubuğunun üstünde görünür', () => {
    const panel = ciz({
      voice: {
        channelName: 'Lobi',
        state: { status: 'connected', micError: null, muted: false, deafened: false, listenOnly: false },
        handlers: {},
      },
    })
    const sesPaneli = panel.querySelector('.voice-panel')
    expect(sesPaneli.textContent).toContain('Lobi')
    expect(sesPaneli.textContent).toContain('Bağlandı')
    expect(sesPaneli.nextElementSibling.classList.contains('user-bar')).toBe(true)
    expect(ciz().querySelector('.voice-panel')).toBeNull()
  })
})
