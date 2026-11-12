// @vitest-environment jsdom
import { it, expect } from 'vitest'
import { renderMemberList } from '../src/ui/memberList.js'

it('üyeler Çevrimiçi/Çevrimdışı gruplanır, nokta rengi ve durum yazısı görünür; metin güvenli', () => {
  const panel = document.createElement('aside')
  const members = [
    { id: 'a', username: 'ayse', color: '#111111' },
    { id: 'b', username: '<b>bora</b>', color: '#222222' },
  ]
  const presence = new Map([['a', { status: 'dnd', statusText: 'toplantıda' }]])
  renderMemberList(panel, { members, presence })
  const basliklar = [...panel.querySelectorAll('.member-group-title')].map((e) => e.textContent)
  expect(basliklar).toEqual(['Çevrimiçi — 1', 'Çevrimdışı — 1'])
  expect(panel.querySelector('.status-dot[data-status=dnd]').style.background).toBe('rgb(224, 91, 91)')
  expect(panel.querySelector('.status-dot[data-status=offline]').style.background).toBe('rgb(107, 114, 128)')
  expect(panel.querySelector('.member-status-text').textContent).toBe('toplantıda')
  expect(panel.querySelector('b')).toBe(null) // HTML olarak yorumlanmadı
})
