// Grup DM veri katmanı (groups.js): RPC adları/argümanları, hata metinleri (gizli CANNOT_ADD),
// liste dönüşümü, görünen ad, grup araması olayı; dms.js grup kaynağı; userEvents "grup_arama".
import { describe, it, expect, vi, beforeEach } from 'vitest'

const fake = vi.hoisted(() => ({}))
vi.mock('../src/lib/supabase.js', () => {
  fake.rpc = vi.fn(async () => ({ data: null, error: null }))
  fake.sorgular = []
  fake.sonuc = { data: null, error: null }
  fake.from = vi.fn((tablo) => {
    const s = { tablo, cagrilar: [] }
    for (const ad of ['select', 'eq', 'insert', 'delete']) {
      s[ad] = (...a) => { s.cagrilar.push([ad, ...a]); return s }
    }
    s.then = (ok, hata) => Promise.resolve(fake.sonuc).then(ok, hata)
    fake.sorgular.push(s)
    return s
  })
  return {
    supabase: {
      rpc: (...a) => fake.rpc(...a),
      from: (...a) => fake.from(...a),
      channel: () => ({ on() { return this }, subscribe() { return this } }),
      removeChannel: async () => {},
      realtime: { setAuth: async () => {} },
    },
  }
})

const ozel = vi.hoisted(() => ({ kurucu: null }))
vi.mock('../src/data/privateChannel.js', () => ({
  openPrivateChannel: (konu, kur) => {
    const k = { ons: [], on(t, f, cb) { k.ons.push({ t, ...f, cb }); return k } }
    kur(k)
    ozel.kurucu = k
    return { close: async () => {} }
  },
}))

import {
  fetchGroupList, createGroup, addGroupMember, removeGroupMember, leaveGroup, renameGroup,
  muteDm, unmuteDm, startGroupCall, joinGroupCall, leaveGroupCall, pingGroupCall,
  parseGroupCallEvent, grupAdi, rozetUyeleri, grupAriyorMetni, aramayaKatilMetni, GRUP_HATALARI,
} from '../src/data/groups.js'
import { dmSource, sistemSatiri } from '../src/data/dms.js'
import { subscribeUserEvents } from '../src/data/userEvents.js'

const ben = { id: 'u0', username: 'berk' }
const ayla = { id: 'u1', username: 'ayla', color: '#111', avatar_url: null }
const kerem = { id: 'u2', username: 'kerem', color: null, avatar_url: 'x.png' }

beforeEach(() => {
  fake.rpc.mockReset()
  fake.rpc.mockImplementation(async () => ({ data: null, error: null }))
  fake.sorgular = []
  fake.sonuc = { data: null, error: null }
})

describe('groups.js', () => {
  it('fetchGroupList: group_dm_list satırlarını konuşma nesnesine çevirir', async () => {
    fake.rpc.mockResolvedValueOnce({
      data: [{
        thread_id: 't1', name: null, owner_id: 'u0', members: [ben, ayla, kerem], created_at: 'c', last_message_at: 'l',
        unread: 3, muted: true, call_id: 'k1', call_count: 2,
      }, { thread_id: 't2', name: 'Oyun', owner_id: 'u1', members: [], unread: 0, muted: false, call_id: null }],
      error: null,
    })
    const l = await fetchGroupList()
    expect(fake.rpc).toHaveBeenCalledWith('group_dm_list')
    expect(l[0]).toMatchObject({ id: 't1', isGroup: true, name: null, ownerId: 'u0', other: null, unread: 3, muted: true, canSend: true, call: { id: 'k1', count: 2 } })
    expect(l[0].members.map((u) => u.username)).toEqual(['berk', 'ayla', 'kerem'])
    expect(l[1].call).toBeNull()
    expect(l[1].muted).toBe(false)
  })

  it('grupAdi: ad varsa o, yoksa diğer üyelerin adları virgülle (kendin hariç)', () => {
    expect(grupAdi({ name: 'Oyun', members: [ben, ayla] }, 'u0')).toBe('Oyun')
    expect(grupAdi({ name: null, members: [ben, ayla, kerem] }, 'u0')).toBe('ayla, kerem')
    expect(grupAdi({ name: null, members: [ben] }, 'u0')).toBe('Grup')
  })

  it('rozetUyeleri: ilk iki diğer üye; tek kişi kaldıysa kendin de', () => {
    expect(rozetUyeleri({ members: [ben, ayla, kerem] }, 'u0').map((u) => u.id)).toEqual(['u1', 'u2'])
    expect(rozetUyeleri({ members: [ben, ayla] }, 'u0').map((u) => u.id)).toEqual(['u1', 'u0'])
  })

  it('RPC adları ve argümanları; ad kırpılır, boş ad null', async () => {
    fake.rpc.mockResolvedValueOnce({ data: 't9', error: null })
    expect(await createGroup(['u1', 'u2'], '  Oyun  ')).toBe('t9')
    expect(fake.rpc).toHaveBeenLastCalledWith('create_group_dm', { uyeler: ['u1', 'u2'], ad: 'Oyun' })
    await createGroup(['u1', 'u2'], '   ')
    expect(fake.rpc).toHaveBeenLastCalledWith('create_group_dm', { uyeler: ['u1', 'u2'], ad: null })
    await addGroupMember('t1', 'u3')
    expect(fake.rpc).toHaveBeenLastCalledWith('add_group_member', { tid: 't1', uid: 'u3' })
    await removeGroupMember('t1', 'u3')
    expect(fake.rpc).toHaveBeenLastCalledWith('remove_group_member', { tid: 't1', uid: 'u3' })
    await leaveGroup('t1')
    expect(fake.rpc).toHaveBeenLastCalledWith('leave_group', { tid: 't1' })
    await renameGroup('t1', '')
    expect(fake.rpc).toHaveBeenLastCalledWith('rename_group', { tid: 't1', ad: null })
  })

  it('hata kodları Türkçeye çevrilir; CANNOT_ADD gizli kod ("Bu kişi eklenemedi.")', async () => {
    for (const [kod, metin] of Object.entries(GRUP_HATALARI)) {
      fake.rpc.mockResolvedValueOnce({ data: null, error: { message: kod } })
      const e = await addGroupMember('t1', 'u3').catch((x) => x)
      expect(e.message).toBe(metin)
      expect(e.code).toBe(kod)
    }
    expect(GRUP_HATALARI.CANNOT_ADD).toBe('Bu kişi eklenemedi.')
  })

  it('sessize alma: dm_mutes ekle/sil; zaten sessizse (23505) hata yok', async () => {
    fake.sonuc = { data: null, error: { code: '23505', message: 'dup' } }
    await muteDm('t1')
    expect(fake.sorgular[0].tablo).toBe('dm_mutes')
    expect(fake.sorgular[0].cagrilar[0]).toEqual(['insert', { thread_id: 't1' }])
    fake.sonuc = { data: null, error: null }
    await unmuteDm('t1')
    expect(fake.sorgular[1].cagrilar).toEqual([['delete'], ['eq', 'thread_id', 't1']])
  })

  it('grup araması RPC\'leri', async () => {
    fake.rpc.mockResolvedValueOnce({ data: { id: 'k1', status: 'ringing', caller: 'u0' }, error: null })
    expect(await startGroupCall('t1')).toEqual({ id: 'k1', status: 'ringing', caller: 'u0', isGroup: true })
    expect(fake.rpc).toHaveBeenLastCalledWith('start_group_call', { tid: 't1' })
    fake.rpc.mockResolvedValueOnce({ data: { id: 'k1', status: 'active' }, error: null })
    expect((await joinGroupCall('k1')).status).toBe('active')
    expect(fake.rpc).toHaveBeenLastCalledWith('join_group_call', { cid: 'k1' })
    await leaveGroupCall('k1', 'timeout')
    expect(fake.rpc).toHaveBeenLastCalledWith('leave_group_call', { cid: 'k1', reason: 'timeout' })
    fake.rpc.mockResolvedValueOnce({ data: true, error: null })
    expect(await pingGroupCall('k1')).toBe(true)
    fake.rpc.mockResolvedValueOnce({ data: null, error: { message: 'ALREADY_IN_CALL' } })
    const e = await startGroupCall('t1').catch((x) => x)
    expect(e.code).toBe('ALREADY_IN_CALL')
  })

  it('parseGroupCallEvent ve metinler', () => {
    expect(parseGroupCallEvent({ call_id: 'k', thread_id: 't', status: 'active', caller: 'u1', count: 3 }))
      .toEqual({ callId: 'k', threadId: 't', status: 'active', caller: 'u1', reason: null, count: 3, participants: null })
    expect(parseGroupCallEvent({ call_id: 'k', thread_id: 't', status: 'active', participants: ['u1', 5, 'u2'] }).participants)
      .toEqual(['u1', 'u2']) // düzeltme turu 1: aramadakiler
    expect(parseGroupCallEvent({ call_id: 'k', thread_id: 't', status: 'x' })).toBeNull()
    expect(parseGroupCallEvent(null)).toBeNull()
    expect(grupAriyorMetni('Oyun', 'berk')).toBe('Oyun · berk arıyor')
    expect(aramayaKatilMetni(3)).toBe('Aramaya katıl (3)')
    expect(aramayaKatilMetni(0)).toBe('Aramaya katıl')
  })
})

describe('dms.js grup kaynağı', () => {
  it('grupta başlık grubun adı, other null, group üyeleri taşır; bire bir aynı kalır', () => {
    const g = dmSource({ id: 't1', isGroup: true, name: null, members: [ben, ayla, kerem], ownerId: 'u0' }, ben)
    expect(g.title).toBe('ayla, kerem')
    expect(g.placeholder).toBe('ayla, kerem grubuna mesaj gönder')
    expect(g.other).toBeNull()
    expect(g.group.members).toHaveLength(3)
    expect(g.ekKlasoru).toBe('d/t1')
    const b = dmSource({ id: 't2', other: ayla }, ben)
    expect(b.title).toBe('ayla')
    expect(b.group).toBeUndefined() // bire bir kaynağın anahtarları değişmez
  })

  it("sistem satırı 'system' de düzenlenemez, silinemez, tepki almaz", () => {
    const g = dmSource({ id: 't1', isGroup: true, members: [ben, ayla, kerem] }, ben)
    const m = { id: 5, author_id: 'u0', kind: 'system', content: "berk, ayla'yı ekledi." }
    expect(sistemSatiri(m)).toBe(true)
    expect(g.canEdit(m)).toBe(false)
    expect(g.canDelete(m)).toBe(false)
    expect(g.canReact(m)).toBe(false)
    expect(g.canPin(m)).toBe(false)
  })
})

describe('userEvents "grup_arama"', () => {
  it('onGroupCall verilince "grup_arama" olay adı ayrıca dinlenir (realtime adla süzer)', () => {
    const gelen = []
    subscribeUserEvents('u0', () => {}, { onGroupCall: (p) => gelen.push(p) })
    const k = ozel.kurucu
    const dinleyici = k.ons.find((o) => o.event === 'grup_arama')
    expect(dinleyici).toBeTruthy()
    dinleyici.cb({ payload: { call_id: 'k' } })
    expect(gelen).toEqual([{ call_id: 'k' }])
  })
})
