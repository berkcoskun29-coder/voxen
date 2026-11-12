// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { getLocalPresencePrefs, setLocalPresencePrefs } from '../src/auth/profilePrefs.js'

beforeEach(() => localStorage.clear())

describe('profilePrefs', () => {
  it('varsayılan değerleri verir', () => {
    expect(getLocalPresencePrefs()).toEqual({ dnd: false, statusText: '' })
  })
  it('kısmi güncellemeyi birleştirir ve durum yazısını 60 karaktere keser', () => {
    setLocalPresencePrefs({ dnd: true })
    setLocalPresencePrefs({ statusText: 'a'.repeat(80) })
    const p = getLocalPresencePrefs()
    expect(p.dnd).toBe(true)
    expect(p.statusText.length).toBe(60)
    expect(JSON.parse(localStorage.getItem('voxen.presence')).dnd).toBe(true)
  })
  it('bozuk localStorage verisinde varsayılana döner', () => {
    localStorage.setItem('voxen.presence', '{bozuk')
    expect(getLocalPresencePrefs()).toEqual({ dnd: false, statusText: '' })
  })
})
