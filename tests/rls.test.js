// Canlı RLS testleri. Gerçek bir Supabase projesi ister:
// .env.test dosyasında SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY olmalı.
// Dosya yoksa testler atlanır.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { loadEnv } from 'vite'

const env = loadEnv('test', process.cwd(), 'SUPABASE_')
const hasEnv = env.SUPABASE_URL && env.SUPABASE_ANON_KEY && env.SUPABASE_SERVICE_ROLE_KEY

describe.skipIf(!hasEnv)('RLS (canlı Supabase)', () => {
  let admin, A, B, C
  const users = []
  let serverId, textChannelId, inviteCode

  // Admin ile test kullanıcısı açıp onun adına giriş yapmış istemci döner
  async function newUser(tag) {
    const email = `${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@voxen.test`
    const password = 'test-sifre-123456'
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
    if (error) throw error
    users.push(data.user.id)
    const client = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY)
    const { error: e2 } = await client.auth.signInWithPassword({ email, password })
    if (e2) throw e2
    return client
  }

  beforeAll(async () => {
    admin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
    A = await newUser('a')
    B = await newUser('b')
    C = await newUser('c')

    const { data, error } = await A.rpc('create_server', { name: 'Test Sunucu' })
    if (error) throw error
    serverId = data
    const { data: ch } = await A.from('channels').select('id').eq('server_id', serverId).eq('kind', 'text').single()
    textChannelId = ch.id
    const { data: sv } = await A.from('servers').select('invite_code').eq('id', serverId).single()
    inviteCode = sv.invite_code
  })

  afterAll(async () => {
    if (serverId) await admin.from('servers').delete().eq('id', serverId)
    for (const id of users) await admin.auth.admin.deleteUser(id)
  })

  it('A sunucu kurar → B listede görmez', async () => {
    const { data } = await B.from('servers').select('id')
    expect(data).toEqual([])
  })

  it('B davet koduyla katılır → kanalları ve mesajları görür', async () => {
    const { error: setupErr } = await A.from('messages').insert({
      channel_id: textChannelId,
      author_id: (await A.auth.getUser()).data.user.id,
      content: 'merhaba',
    })
    expect(setupErr).toBeNull()
    const { error } = await B.rpc('join_server_by_invite', { code: inviteCode })
    expect(error).toBeNull()
    const { data: chs } = await B.from('channels').select('id').eq('server_id', serverId)
    expect(chs.length).toBe(2)
    const { data: msgs } = await B.from('messages').select('content').eq('channel_id', textChannelId)
    expect(msgs.map((m) => m.content)).toContain('merhaba')
  })

  it('üye olmayan C mesaj atamaz', async () => {
    const { error } = await C.from('messages').insert({
      channel_id: textChannelId,
      author_id: (await C.auth.getUser()).data.user.id,
      content: 'selam',
    })
    expect(error).not.toBeNull()
  })

  it('2001 karakterlik mesaj reddedilir', async () => {
    const { error } = await A.from('messages').insert({
      channel_id: textChannelId,
      author_id: (await A.auth.getUser()).data.user.id,
      content: 'x'.repeat(2001),
    })
    expect(error).not.toBeNull()
  })

  it('B kanal oluşturamaz (sahip değil)', async () => {
    const { error } = await B.from('channels').insert({ server_id: serverId, name: 'yeni', kind: 'text', position: 5 })
    expect(error).not.toBeNull()
  })

  it('üye olmayan C mesajları okuyamaz', async () => {
    const { data } = await C.from('messages').select('id').eq('channel_id', textChannelId)
    expect(data).toEqual([])
  })

  it('üye başkasının author_id değeriyle mesaj atamaz', async () => {
    const aId = (await A.auth.getUser()).data.user.id
    const { error } = await B.from('messages').insert({ channel_id: textChannelId, author_id: aId, content: 'sahte' })
    expect(error).not.toBeNull()
  })

  it('sahip A kanal oluşturabilir ve silebilir', async () => {
    const { data, error } = await A.from('channels')
      .insert({ server_id: serverId, name: 'gecici', kind: 'text', position: 9 })
      .select('id')
      .single()
    expect(error).toBeNull()
    const { error: delErr } = await A.from('channels').delete().eq('id', data.id)
    expect(delErr).toBeNull()
    const { data: left } = await admin.from('channels').select('id').eq('id', data.id)
    expect(left).toEqual([])
  })

  it('sahip olmayan B kanal silemez', async () => {
    await B.from('channels').delete().eq('id', textChannelId)
    // RLS silmeyi sessizce 0 satıra çevirir; kanal hâlâ durmalı
    const { data } = await admin.from('channels').select('id').eq('id', textChannelId)
    expect(data.length).toBe(1)
  })

  // 004 kısıtları (renk, avatar adresi, büyük/küçük harf duyarsız kullanıcı adı).
  // 004 veritabanına henüz yüklenmediyse bu testler ATLANIR: önce bir yoklama yapılır
  // (yönetici anahtarıyla bozuk renk yazmayı dener; kısıt yoksa yazılır, eski haline döndürülür).
  describe('profil kısıtları (004)', () => {
    let var004 = false
    let aId, bId, aAdi
    const rastgeleAd = () => `t${Math.random().toString(36).slice(2, 10)}`

    beforeAll(async () => {
      aId = (await A.auth.getUser()).data.user.id
      bId = (await B.auth.getUser()).data.user.id
      aAdi = rastgeleAd()
      const e1 = (await A.from('profiles').insert({ id: aId, username: aAdi, color: '#3be37a' })).error
      const e2 = (await B.from('profiles').insert({ id: bId, username: rastgeleAd(), color: '#3be37a' })).error
      if (e1 || e2) throw e1 ?? e2
      const { error } = await admin.from('profiles').update({ color: 'bozuk' }).eq('id', aId)
      var004 = !!error
      if (!var004) await admin.from('profiles').update({ color: '#3be37a' }).eq('id', aId)
    })

    it('bozuk renk reddedilir, paletteki renk kabul edilir', async (ctx) => {
      if (!var004) ctx.skip()
      const kotu = await A.from('profiles').update({ color: 'red;background:url(x)' }).eq('id', aId)
      expect(kotu.error?.code).toBe('23514')
      const iyi = await A.from('profiles').update({ color: '#f5a524' }).eq('id', aId)
      expect(iyi.error).toBeNull()
    })

    it('avatar adresi sadece supabase avatars deposu olabilir', async (ctx) => {
      if (!var004) ctx.skip()
      const kotu = await A.from('profiles').update({ avatar_url: 'https://kotu.example.com/x.png' }).eq('id', aId)
      expect(kotu.error?.code).toBe('23514')
      const iyi = await A.from('profiles')
        .update({ avatar_url: `${env.SUPABASE_URL}/storage/v1/object/public/avatars/${aId}.webp?v=1` })
        .eq('id', aId)
      expect(iyi.error).toBeNull()
      const bos = await A.from('profiles').update({ avatar_url: null }).eq('id', aId)
      expect(bos.error).toBeNull()
    })

    it('kullanıcı adı büyük/küçük harf farkıyla tekrar alınamaz', async (ctx) => {
      if (!var004) ctx.skip()
      const { error } = await B.from('profiles').update({ username: aAdi.toUpperCase() }).eq('id', bId)
      expect(error?.code).toBe('23505')
    })
  })
})
