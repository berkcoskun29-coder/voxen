// @vitest-environment jsdom
// Sunucu/kanal testleri: Supabase sahte nesneyle değiştirilir, ağ kullanılmaz.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const fake = vi.hoisted(() => ({}))

vi.mock('../src/lib/supabase.js', () => {
  fake.rpc = vi.fn(async () => ({ data: 'srv1', error: null }))
  // from('tablo').select().eq().order() zincirini taklit eder; sonuç fake.rows'tan gelir.
  fake.rows = {}
  fake.from = vi.fn((tablo) => {
    const zincir = {
      select: () => zincir,
      eq: () => zincir,
      lt: () => zincir,
      in: () => zincir,
      limit: () => zincir,
      order: () => zincir,
      insert: async () => ({ error: null }),
      then: (res) => res({ data: fake.rows[tablo] ?? [], error: null }),
    }
    return zincir
  })
  // Sohbet (Görev 4) abonelik açar; burada sadece sahte
  const kanal = { on: () => kanal, subscribe: () => kanal }
  return { supabase: { rpc: (...a) => fake.rpc(...a), from: (...a) => fake.from(...a), channel: () => kanal, removeChannel: () => {} } }
})

import { getInviteLink, inviteToCopy, joinByInvite } from '../src/data/servers.js'
import { listChannels } from '../src/data/channels.js'
import { renderChannelList } from '../src/ui/channelList.js'
import { startApp } from '../src/ui/app.js'

const profil = { id: 'u1', username: 'berk', color: '#5b7cfa' }

beforeEach(() => {
  fake.rpc.mockClear()
  fake.rpc.mockImplementation(async () => ({ data: 'srv1', error: null }))
  fake.rows = {}
  sessionStorage.clear()
  localStorage.clear()
  location.hash = ''
  document.body.innerHTML = '<div id="app"></div>'
})

describe('getInviteLink', () => {
  it('getInviteLink doğru URL üretir', () => {
    expect(getInviteLink({ invite_code: 'abc123' }, { publicUrl: '', desktop: false })).toBe(`${location.origin}/#/davet/abc123`)
  })
})

describe('davet linki', () => {
  it('#/davet/KOD adresi açılınca joinByInvite(KOD) çağrılır ve sunucu seçilir', async () => {
    fake.rows.servers = [{ id: 'srv1', name: 'Arkadaşlar', owner_id: 'x', invite_code: 'KOD' }]
    fake.rows.channels = [{ id: 'c1', server_id: 'srv1', name: 'genel', kind: 'text', position: 0 }]
    location.hash = '#/davet/KOD'
    await startApp(document.querySelector('#app'), profil)
    expect(fake.rpc).toHaveBeenCalledWith('join_server_by_invite', { code: 'KOD' })
    expect(document.querySelector('.server-icon.selected')).not.toBeNull()
    expect(document.querySelector('.channel-panel h2').textContent).toBe('Arkadaşlar')
    expect(location.hash).toBe('') // başarıdan sonra adres temizlenir
  })

  it('geçersiz davet hata mesajı gösterir ve normal ekranda kalır', async () => {
    fake.rpc.mockImplementation(async () => ({ data: null, error: { message: 'Geçersiz davet kodu' } }))
    location.hash = '#/davet/YANLIS'
    await startApp(document.querySelector('#app'), profil)
    expect(document.body.textContent).toContain('Bu davet bulunamadı. Linki yeniden kopyalayıp yapıştır.')
    expect(document.querySelector('.server-rail')).not.toBeNull()
  })

  it('oturum açmadan önce saklanan davet kodu kullanılır', async () => {
    fake.rows.servers = [{ id: 'srv1', name: 'S', owner_id: 'x', invite_code: 'KOD' }]
    sessionStorage.setItem('voxen.pendingInvite', 'KOD')
    await startApp(document.querySelector('#app'), profil)
    expect(fake.rpc).toHaveBeenCalledWith('join_server_by_invite', { code: 'KOD' })
    expect(sessionStorage.getItem('voxen.pendingInvite')).toBeNull()
  })
})

describe('kanallar', () => {
  it('listChannels position sırasına göre ister', async () => {
    fake.rows.channels = [{ id: 'c1', name: 'genel', kind: 'text', position: 0 }]
    const r = await listChannels('srv1')
    expect(r).toHaveLength(1)
    expect(fake.from).toHaveBeenCalledWith('channels')
  })

  it('kanal listesi yazılı ve sesli kanalları ayrı başlıklar altında gösterir', () => {
    const panel = document.createElement('div')
    renderChannelList(panel, {
      server: { id: 's', name: 'S', owner_id: 'u1', invite_code: 'k' },
      channels: [
        { id: 'a', name: 'genel', kind: 'text', position: 0 },
        { id: 'b', name: '🔊 Lobi', kind: 'voice', position: 1 },
      ],
      profile: profil,
      selectedChannelId: null,
      handlers: {},
    })
    const basliklar = [...panel.querySelectorAll('.section-title')].map((e) => e.textContent)
    expect(basliklar).toEqual(['Yazılı kanallar', 'Sesli kanallar'])
    const gruplar = panel.querySelectorAll('.channel-group')
    expect(gruplar[0].textContent).toContain('genel')
    expect(gruplar[0].textContent).not.toContain('Lobi')
    expect(gruplar[1].textContent).toContain('Lobi')
    expect(panel.textContent).toContain('+ kanal') // sahip olduğu için
    expect(panel.textContent).toContain('Davet et')
  })

  it('sahip olmayana "+ kanal" gösterilmez', () => {
    const panel = document.createElement('div')
    renderChannelList(panel, {
      server: { id: 's', name: 'S', owner_id: 'baska', invite_code: 'k' },
      channels: [], profile: profil, selectedChannelId: null, handlers: {},
    })
    expect(panel.textContent).not.toContain('+ kanal')
  })
})

describe('davet kopyalama (masaüstü)', () => {
  const s = { invite_code: 'abc123' }
  it('VITE_PUBLIC_URL verilmişse link ondan kurulur (sondaki / atılır)', () => {
    expect(getInviteLink(s, { publicUrl: 'https://voxen.app/', desktop: true })).toBe('https://voxen.app/#/davet/abc123')
    expect(getInviteLink(s, { publicUrl: 'https://voxen.app', desktop: false })).toBe('https://voxen.app/#/davet/abc123')
  })
  it('masaüstünde adres yoksa link yok: sadece kod kopyalanır', () => {
    expect(getInviteLink(s, { publicUrl: '', desktop: true })).toBeNull()
    expect(inviteToCopy(s, { publicUrl: '', desktop: true })).toEqual({ text: 'abc123', message: 'Davet kodu kopyalandı' })
  })
  it('tarayıcıda adres yoksa bulunduğumuz site kullanılır', () => {
    expect(inviteToCopy(s, { publicUrl: '', desktop: false }))
      .toEqual({ text: `${location.origin}/#/davet/abc123`, message: 'Davet linki kopyalandı' })
  })
})
