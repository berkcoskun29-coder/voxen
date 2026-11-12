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

it('avatar harfi arka plana uygun renkte; çevrimdışında yalnız avatar soluk, satır değil', () => {
  const panel = document.createElement('aside')
  const members = [
    { id: 'a', username: 'ayla', color: '#3be37a' }, // açık renk: koyu harf
    { id: 'k', username: 'kerem', color: '#111111' }, // eski, koyu renk: beyaz harf
  ]
  renderMemberList(panel, { members, presence: new Map([['a', { status: 'online' }]]) })
  const avatarlar = panel.querySelectorAll('.member-avatar')
  expect(avatarlar[0].style.color).toBe('rgb(15, 26, 20)')
  expect(avatarlar[1].style.color).toBe('rgb(255, 255, 255)')
  const cevrimdisi = panel.querySelector('.member-row.offline')
  expect(cevrimdisi.querySelector('.member-avatar').classList.contains('dim')).toBe(true)
  expect(cevrimdisi.querySelector('.status-dot').classList.contains('dim')).toBe(false)
  expect(panel.querySelector('.member-row:not(.offline) .member-avatar').classList.contains('dim')).toBe(false)
})
