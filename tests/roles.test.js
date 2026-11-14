// Roller veri katmanı (src/data/roles.js): RPC adları/argümanları, hata metinleri, sorgular;
// serverEvents "roller" olayı (aynı server: konusu, yeni abonelik yok).
import { describe, it, expect, vi, beforeEach } from 'vitest'

const fake = vi.hoisted(() => ({}))
vi.mock('../src/lib/supabase.js', () => {
  fake.rpc = vi.fn(async () => ({ data: null, error: null }))
  fake.sorgular = []
  fake.sonuc = { data: [], error: null }
  fake.from = vi.fn((tablo) => {
    const s = { tablo, cagrilar: [] }
    for (const ad of ['select', 'eq', 'order']) s[ad] = (...a) => { s.cagrilar.push([ad, ...a]); return s }
    s.then = (ok, hata) => Promise.resolve(typeof fake.sonuc === 'function' ? fake.sonuc(tablo) : fake.sonuc).then(ok, hata)
    fake.sorgular.push(s)
    return s
  })
  return { supabase: { rpc: (...a) => fake.rpc(...a), from: (...a) => fake.from(...a) } }
})

const ozel = vi.hoisted(() => ({ kanallar: [] }))
vi.mock('../src/data/privateChannel.js', () => ({
  openPrivateChannel: (konu, kur) => {
    const k = { konu, ons: [], on(t, f, cb) { k.ons.push({ t, ...f, cb }); return k } }
    kur(k)
    ozel.kanallar.push(k)
    return { close: () => {} }
  },
}))

import {
  ROL_HATALARI, listRoles, listMemberRoles, loadServerRoles, createRole, updateRole, deleteRole, moveRole, setMemberRole,
  kickMember, regenerateInvite, moveChannel, hasPermission,
} from '../src/data/roles.js'
import { subscribeServerEvents } from '../src/data/serverEvents.js'

beforeEach(() => {
  fake.rpc.mockReset()
  fake.rpc.mockImplementation(async () => ({ data: null, error: null }))
  fake.sorgular = []
  fake.sonuc = { data: [], error: null }
  ozel.kanallar = []
})

describe('RPC çağrıları', () => {
  it('adlar ve argümanlar SQL imzalarıyla aynı', async () => {
    fake.rpc.mockImplementation(async (ad) => ({ data: ad === 'create_role' ? 'yeni-id' : ad === 'regenerate_invite' ? 'abcd1234' : null, error: null }))
    expect(await createRole('s', { name: '  Mod ', color: 'mavi', permissions: ['MANAGE_MESSAGES'] })).toBe('yeni-id')
    await updateRole('r', { name: 'Mod', color: null, permissions: [], hoist: 1 })
    await deleteRole('r')
    await moveRole('r', 3)
    await setMemberRole('s', 'u', 'r', 0)
    await kickMember('s', 'u')
    expect(await regenerateInvite('s')).toBe('abcd1234')
    await moveChannel('k', -1)
    expect(fake.rpc.mock.calls).toEqual([
      ['create_role', { sid: 's', ad: 'Mod', renk: 'mavi', izinler: ['MANAGE_MESSAGES'] }],
      ['update_role', { rid: 'r', ad: 'Mod', renk: null, izinler: [], ayri: true }],
      ['delete_role', { rid: 'r' }],
      ['move_role', { rid: 'r', hedef: 3 }],
      ['set_member_role', { sid: 's', uid: 'u', rid: 'r', ver: false }],
      ['kick_member', { sid: 's', uid: 'u' }],
      ['regenerate_invite', { sid: 's' }],
      ['move_channel', { cid: 'k', yon: -1 }],
    ])
  })

  it('hata kodları Türkçeye çevrilir; bilinmeyen metin genel hataya düşer', async () => {
    for (const [kod, metin] of Object.entries(ROL_HATALARI)) {
      fake.rpc.mockImplementationOnce(async () => ({ data: null, error: { message: kod } }))
      const e = await deleteRole('r').catch((x) => x)
      expect(e.message).toBe(metin)
      expect(e.code).toBe(kod)
    }
    fake.rpc.mockImplementationOnce(async () => ({ data: null, error: { message: 'relation does not exist' } }))
    const e = await kickMember('s', 'u').catch((x) => x)
    expect(e.code).toBeNull()
    expect(e.message).not.toContain('relation')
  })

  it('hasPermission: yalnız true ise true; hata ya da istisnada false', async () => {
    fake.rpc.mockImplementationOnce(async () => ({ data: true, error: null }))
    expect(await hasPermission('s', 'u', 'MENTION_EVERYONE')).toBe(true)
    expect(fake.rpc).toHaveBeenLastCalledWith('has_permission', { sid: 's', uid: 'u', perm: 'MENTION_EVERYONE' })
    fake.rpc.mockImplementationOnce(async () => ({ data: null, error: { message: 'x' } }))
    expect(await hasPermission('s', 'u', 'MENTION_EVERYONE')).toBe(false)
    fake.rpc.mockImplementationOnce(async () => { throw new Error('ağ') })
    expect(await hasPermission('s', 'u', 'MENTION_EVERYONE')).toBe(false)
  })
})

describe('sorgular', () => {
  it('roller: sunucuya göre, düz select (gömme yok), izinler hep dizi', async () => {
    fake.sonuc = { data: [{ id: 'r', permissions: null }], error: null }
    expect(await listRoles('s')).toEqual([{ id: 'r', permissions: [] }])
    const q = fake.sorgular[0]
    expect(q.tablo).toBe('roles')
    expect(q.cagrilar[0][1]).not.toMatch(/\(/)
    expect(q.cagrilar).toContainEqual(['eq', 'server_id', 's'])
  })
  it('atamalar ve birlikte yükleme; hata fırlatır', async () => {
    fake.sonuc = (tablo) => ({ data: tablo === 'roles' ? [{ id: 'r', permissions: ['KICK_MEMBERS'] }] : [{ user_id: 'u', role_id: 'r' }], error: null })
    expect(await loadServerRoles('s')).toEqual({ roles: [{ id: 'r', permissions: ['KICK_MEMBERS'] }], memberRoles: [{ user_id: 'u', role_id: 'r' }] })
    expect(fake.sorgular.find((q) => q.tablo === 'member_roles').cagrilar[0]).toEqual(['select', 'user_id, role_id'])
    fake.sonuc = { data: null, error: { message: 'yok' } }
    await expect(listMemberRoles('s')).rejects.toThrow('yok')
  })
})

describe('serverEvents: "roller" olayı', () => {
  it('aynı server: kanalında dinlenir (yeni abonelik yok); onRoles olmadan dinleyici kurulmaz', () => {
    const onRoles = vi.fn()
    const abone = subscribeServerEvents(['s1'], () => {}, { onRoles })
    expect(ozel.kanallar).toHaveLength(1)
    const k = ozel.kanallar[0]
    expect(k.konu).toBe('server:s1')
    const dinleyici = k.ons.find((o) => o.event === 'roller')
    dinleyici.cb({ payload: { tablo: 'member_roles', user_id: 'u' } })
    expect(onRoles).toHaveBeenCalledWith('s1', { tablo: 'member_roles', user_id: 'u' })
    abone.close()
    dinleyici.cb({ payload: {} })
    expect(onRoles).toHaveBeenCalledTimes(1) // kapandıktan sonra gelmez

    subscribeServerEvents(['s2'], () => {})
    expect(ozel.kanallar[1].ons.some((o) => o.event === 'roller')).toBe(false)
  })
})
