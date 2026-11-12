// @vitest-environment jsdom
// "Sunucuya katıl" düğmesi: giriş ayrıştırma + modal akışı (Supabase sahte).
import { describe, it, expect, vi, beforeEach } from 'vitest'

const fake = vi.hoisted(() => ({}))

vi.mock('../src/lib/supabase.js', () => {
  fake.rpc = vi.fn(async () => ({ data: 'srv1', error: null }))
  fake.rows = {}
  fake.from = vi.fn((tablo) => {
    const zincir = {
      select: () => zincir, eq: () => zincir, lt: () => zincir, in: () => zincir,
      limit: () => zincir, order: () => zincir,
      insert: async () => ({ error: null }),
      then: (res) => res({ data: fake.rows[tablo] ?? [], error: null }),
    }
    return zincir
  })
  const kanal = { on: () => kanal, subscribe: () => kanal }
  return { supabase: { rpc: (...a) => fake.rpc(...a), from: (...a) => fake.from(...a), channel: () => kanal, removeChannel: () => {} } }
})

import { parseInviteInput, inviteFromHash } from '../src/ui/invite.js'
import { startApp } from '../src/ui/app.js'

const profil = { id: 'u1', username: 'berk', color: '#5b7cfa' }

describe('parseInviteInput', () => {
  it('tam link', () => expect(parseInviteInput('https://voxen.app/#/davet/KOD')).toBe('KOD'))
  it('sonda slash ve boşluklu link', () => expect(parseInviteInput('  http://localhost:5173/#/davet/KOD/ ')).toBe('KOD'))
  it('sadece kod', () => expect(parseInviteInput('KOD')).toBe('KOD'))
  it('boşluklu kod', () => expect(parseInviteInput('  abc123  ')).toBe('abc123'))
  it('alakasız URL null', () => expect(parseInviteInput('https://example.com/baska')).toBeNull())
  it('bozuk % dizisi null', () => expect(parseInviteInput('https://x/#/davet/%E0%A4%A')).toBeNull())
  it('boş null', () => { expect(parseInviteInput('')).toBeNull(); expect(parseInviteInput('   ')).toBeNull() })
})

describe('Sunucuya katıl düğmesi', () => {
  beforeEach(() => {
    fake.rpc.mockClear()
    fake.rpc.mockImplementation(async () => ({ data: 'srv1', error: null }))
    fake.rows = {
      servers: [{ id: 'srv1', name: 'Arkadaşlar', owner_id: 'x', invite_code: 'KOD' }],
      channels: [{ id: 'c1', server_id: 'srv1', name: 'genel', kind: 'text', position: 0 }],
    }
    sessionStorage.clear(); localStorage.clear(); location.hash = ''
    document.body.innerHTML = '<div id="app"></div>'
  })

  async function ac() {
    await startApp(document.querySelector('#app'), profil)
    document.querySelector('.server-icon.join').click()
    return document.querySelector('.modal-back input')
  }

  it('link yapıştırılınca joinByInvite çağrılır ve sunucu seçilir', async () => {
    const input = await ac()
    expect(document.querySelector('.modal-back h1').textContent).toBe('Sunucuya katıl')
    input.value = 'https://voxen.app/#/davet/KOD'
    ;[...document.querySelectorAll('.modal-back button')].find((b) => b.textContent === 'Katıl').click()
    await vi.waitFor(() => expect(document.querySelector('.modal-back')).toBeNull())
    expect(fake.rpc).toHaveBeenCalledWith('join_server_by_invite', { code: 'KOD' })
    expect(document.querySelector('.channel-panel h2').textContent).toBe('Arkadaşlar')
  })

  it('geçersiz girdi: RPC çağrılmaz, hata görünür', async () => {
    const input = await ac()
    fake.rpc.mockClear()
    input.value = 'https://example.com/x'
    ;[...document.querySelectorAll('.modal-back button')].find((b) => b.textContent === 'Katıl').click()
    await vi.waitFor(() => expect(document.querySelector('.modal-back .error').textContent).toBe('Davet linki geçersiz'))
    expect(fake.rpc).not.toHaveBeenCalled()
  })

  it('bozuk linkte hata görünür, RPC çağrılmaz', async () => {
    const input = await ac()
    fake.rpc.mockClear()
    input.value = 'https://x/#/davet/%E0%A4%A'
    ;[...document.querySelectorAll('.modal-back button')].find((b) => b.textContent === 'Katıl').click()
    await vi.waitFor(() => expect(document.querySelector('.modal-back .error').textContent).toBe('Davet linki geçersiz'))
    expect(fake.rpc).not.toHaveBeenCalled()
  })

  it('RPC hatası modalda gösterilir', async () => {
    const input = await ac()
    fake.rpc.mockImplementation(async () => ({ data: null, error: { message: 'x' } }))
    input.value = 'YANLIS'
    ;[...document.querySelectorAll('.modal-back button')].find((b) => b.textContent === 'Katıl').click()
    await vi.waitFor(() => expect(document.querySelector('.modal-back .error').textContent).toBe('Davet linki geçersiz'))
  })
})

describe('inviteFromHash', () => {
  it('bozuk % dizisi hata fırlatmaz, null döner', () => {
    location.hash = '#/davet/%E0'
    expect(inviteFromHash()).toBeNull()
    location.hash = '#/davet/abc'
    expect(inviteFromHash()).toBe('abc')
    location.hash = ''
  })
})
