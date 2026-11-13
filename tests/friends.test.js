// Arkadaşlık (friends.js): RPC adları/argümanları, hata kodlarının Türkçe metne çevrilmesi, liste ayrımı.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const fake = vi.hoisted(() => ({}))
vi.mock('../src/lib/supabase.js', () => {
  fake.rpc = vi.fn(async () => ({ data: null, error: null }))
  fake.tablolar = {}
  fake.sorgular = []
  // Zincirlenebilir sorgu: her çağrı kaydedilir, await edilince tablonun verisi döner
  fake.from = vi.fn((tablo) => {
    const s = { tablo, cagrilar: [] }
    for (const ad of ['select', 'eq', 'in', 'order', 'is']) {
      s[ad] = (...a) => { s.cagrilar.push([ad, ...a]); return s }
    }
    s.then = (ok, hata) => Promise.resolve(fake.tablolar[tablo] ?? { data: [], error: null }).then(ok, hata)
    fake.sorgular.push(s)
    return s
  })
  return {
    supabase: {
      rpc: (...a) => fake.rpc(...a),
      from: (...a) => fake.from(...a),
      auth: { getSession: (...a) => fake.getSession(...a) },
    },
  }
})

import {
  fetchFriends, sendFriendRequest, acceptFriend, declineFriend, removeFriend, blockUser, unblockUser,
  rpcHatasi, HATA_METINLERI,
} from '../src/data/friends.js'

beforeEach(() => {
  fake.rpc.mockReset()
  fake.rpc.mockImplementation(async () => ({ data: null, error: null }))
  fake.tablolar = {}
  fake.sorgular = []
  fake.getSession = async () => ({ data: { session: { user: { id: 'ben' } } } })
})

const hataVer = (kod) => fake.rpc.mockImplementation(async () => ({ data: null, error: { message: kod, code: 'P0001' } }))

describe('RPC adları ve argümanları', () => {
  it('sendFriendRequest: send_friend_request({ username }) kırpılmış adla; sonucu döner', async () => {
    fake.rpc.mockImplementation(async () => ({ data: 'sent', error: null }))
    expect(await sendFriendRequest('  ayla ')).toBe('sent')
    expect(fake.rpc).toHaveBeenCalledWith('send_friend_request', { username: 'ayla' })
    fake.rpc.mockImplementation(async () => ({ data: 'accepted', error: null }))
    expect(await sendFriendRequest('kerem')).toBe('accepted') // karşı taraf zaten istemişti: eşleşme
  })

  it('diğer çağrılar { other } alır', async () => {
    await acceptFriend('u1')
    await declineFriend('u2')
    await removeFriend('u3')
    await blockUser('u4')
    await unblockUser('u5')
    expect(fake.rpc.mock.calls).toEqual([
      ['accept_friend_request', { other: 'u1' }],
      ['decline_friend_request', { other: 'u2' }],
      ['remove_friend', { other: 'u3' }],
      ['block_user', { other: 'u4' }],
      ['unblock_user', { other: 'u5' }],
    ])
  })
})

describe('hata kodları Türkçe metne çevrilir (spec §1)', () => {
  const beklenen = {
    NO_USER: 'Böyle bir kullanıcı yok.',
    ALREADY_FRIENDS: 'Zaten arkadaşsınız.',
    ALREADY_SENT: 'Bu kişiye zaten istek gönderdin.',
    SELF: 'Kendine istek gönderemezsin.',
    TOO_MANY: 'Çok fazla bekleyen isteğin var.',
  }
  for (const [kod, metin] of Object.entries(beklenen)) {
    it(`${kod} -> "${metin}"`, async () => {
      hataVer(kod)
      const e = await sendFriendRequest('x').catch((h) => h)
      expect(e).toBeInstanceOf(Error)
      expect(e.message).toBe(metin)
      expect(e.code).toBe(kod)
    })
  }

  it('engel ayrı bir metin üretmez: veritabanı NO_USER atar, "Böyle bir kullanıcı yok." görünür', () => {
    expect(HATA_METINLERI.NO_USER).toBe('Böyle bir kullanıcı yok.')
    expect(Object.values(HATA_METINLERI).join(' ')).not.toMatch(/engel/i)
  })

  it('tanınmayan hata genel metne düşer, ham İngilizce mesaj gösterilmez', async () => {
    fake.rpc.mockImplementation(async () => ({ data: null, error: { message: 'connection refused' } }))
    const e = await acceptFriend('u1').catch((h) => h)
    expect(e.message).toBe('Bir şeyler ters gitti. İnternetini kontrol edip tekrar dene.')
    expect(e.code).toBe(null)
  })

  it('blockUser: SELF istek cümlesiyle değil, engel cümlesiyle; NO_USER aynı', async () => {
    hataVer('SELF')
    expect((await blockUser('ben').catch((h) => h)).message).toBe('Kendini engelleyemezsin.')
    hataVer('NO_USER')
    expect((await blockUser('x').catch((h) => h)).message).toBe('Böyle bir kullanıcı yok.')
  })

  it('DM kodları: BLOCKED_DM ve NOT_ALLOWED aynı metne çevrilir (engel ayırt edilmez)', () => {
    expect(rpcHatasi({ message: 'BLOCKED_DM' }).message).toBe('Bu kişiye mesaj gönderemezsin.')
    expect(rpcHatasi({ message: 'NOT_ALLOWED' }).message).toBe('Bu kişiye mesaj gönderemezsin.')
  })
})

describe('fetchFriends', () => {
  it('arkadaşlar, gelen, giden ve engellenenleri profilleriyle ayırır', async () => {
    fake.tablolar.friendships = {
      data: [
        { user_a: 'a1', user_b: 'ben', requester: 'a1', status: 'accepted', created_at: '2026-11-01', accepted_at: '2026-11-02' },
        { user_a: 'ben', user_b: 'z9', requester: 'ben', status: 'accepted', created_at: '2026-11-01', accepted_at: '2026-11-03' },
        { user_a: 'ben', user_b: 'g1', requester: 'g1', status: 'pending', created_at: '2026-11-05' },
        { user_a: 'ben', user_b: 'g2', requester: 'g2', status: 'pending', created_at: '2026-11-07' },
        { user_a: 'c1', user_b: 'ben', requester: 'ben', status: 'pending', created_at: '2026-11-06' },
      ],
      error: null,
    }
    fake.tablolar.blocks = { data: [{ blocker: 'ben', blocked: 'e1', created_at: '2026-11-08' }], error: null }
    fake.tablolar.profiles = {
      data: [
        { id: 'a1', username: 'Zeynep', color: '#111111', avatar_url: null },
        { id: 'z9', username: 'ayla', color: '#222222', avatar_url: null },
        { id: 'g1', username: 'gelen1', color: '#333333', avatar_url: null },
        { id: 'g2', username: 'gelen2', color: '#444444', avatar_url: null },
        { id: 'c1', username: 'giden', color: '#555555', avatar_url: null },
        { id: 'e1', username: 'engelli', color: '#666666', avatar_url: null },
      ],
      error: null,
    }
    const s = await fetchFriends('ben')
    expect(s.friends.map((f) => f.username)).toEqual(['ayla', 'Zeynep']) // ada göre
    expect(s.friends[0]).toMatchObject({ id: 'z9', accepted_at: '2026-11-03' })
    expect(s.incoming.map((f) => f.id)).toEqual(['g2', 'g1']) // en yenisi üstte
    expect(s.outgoing.map((f) => f.id)).toEqual(['c1'])
    expect(s.blocked.map((f) => f.id)).toEqual(['e1'])
    // profiller tek sorguda
    const profil = fake.sorgular.filter((q) => q.tablo === 'profiles')
    expect(profil).toHaveLength(1)
    expect(profil[0].cagrilar.find((c) => c[0] === 'in')[2].slice().sort()).toEqual(['a1', 'c1', 'e1', 'g1', 'g2', 'z9'])
  })

  it('selfId verilmezse oturumdan alınır', async () => {
    fake.tablolar.friendships = { data: [{ user_a: 'ben', user_b: 'x', requester: 'x', status: 'pending', created_at: 't' }], error: null }
    fake.tablolar.profiles = { data: [{ id: 'x', username: 'xx' }], error: null }
    const s = await fetchFriends()
    expect(s.incoming.map((f) => f.id)).toEqual(['x'])
  })

  it('oturum yoksa fırlatır (gelen/giden ayrılamaz)', async () => {
    fake.getSession = async () => ({ data: { session: null } })
    fake.tablolar.friendships = { data: [{ user_a: 'a', user_b: 'x', requester: 'x', status: 'pending', created_at: 't' }], error: null }
    await expect(fetchFriends()).rejects.toThrow('Giriş yapmalısın')
    expect(fake.sorgular).toHaveLength(0)
  })

  it('sorgu hatasında fırlatır', async () => {
    fake.tablolar.friendships = { data: null, error: { message: 'olmadı' } }
    await expect(fetchFriends('ben')).rejects.toThrow('olmadı')
  })
})
