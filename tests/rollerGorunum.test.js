// @vitest-environment jsdom
// Roller görünümü (v0.11.0): mesajda yazar rengi ve @herkes, silme/sabitleme düğmeleri, üye listesi grupları,
// kanal listesinde yönetim düğmeleri, profil kartında roller ve çıkarma.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../src/lib/supabase.js', () => ({ supabase: {} }))

import { mountChat } from '../src/ui/chatView.js'
import { renderMemberList } from '../src/ui/memberList.js'
import { renderChannelList } from '../src/ui/channelList.js'
import { buildProfileCard, closeProfileCard } from '../src/ui/profileCard.js'

const ben = { id: 'u1', username: 'berk', color: '#5b7cfa', avatar_url: null }
const ali = { id: 'u2', username: 'ali', color: '#e05b5b', avatar_url: null }
const bosalt = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0)) }
const satir = (id, author, content) => ({ id, author_id: author, content, created_at: new Date(Date.UTC(2026, 10, 13, 10, id)).toISOString(), edited_at: null, deleted_at: null })

afterEach(() => { closeProfileCard(); document.body.innerHTML = '' })

describe('sohbet: roller', () => {
  let alan
  beforeEach(() => { alan = document.createElement('div'); document.body.appendChild(alan) })


  function sahteKaynak(satirlar, yetki) {
    return {
      kind: 'channel', id: 'c1', title: 'genel', placeholder: 'yaz…', canSend: true,
      canDelete: (m) => m.author_id === 'u1' || yetki().has('MANAGE_MESSAGES'),
      canPin: () => yetki().has('MANAGE_MESSAGES'),
      canReact: () => true,
      fetch: async () => satirlar.slice(),
      send: vi.fn(), edit: async () => ({ ok: true }), remove: async () => {},
      subscribe: () => () => {},
      joinTyping: () => ({ typing() {}, stopped() {}, clear() {}, leave: async () => {} }),
    }
  }

  it('yazar adı en yüksek renkli rolün renginde; rengi yoksa profil rengi; rollerDegisti yeniden çizer', async () => {
    let renkler = { u2: 'var(--rol-mor)' }
    const s = mountChat(alan, {
      source: sahteKaynak([satir(1, 'u2', 'selam'), satir(10, 'u1', 'merhaba')], () => new Set()),
      profile: ben, members: [ben, ali], getRolRengi: (id) => renkler[id] ?? null,
    })
    await bosalt()
    const yazar = (id) => alan.querySelector(`.message[data-id="${id}"] .msg-author`)
    expect(yazar(1).style.color).toBe('var(--rol-mor)')
    expect(yazar(10).style.color).not.toContain('--rol')
    renkler = {}
    s.rollerDegisti()
    expect(yazar(1).style.color).not.toContain('--rol')
    s.destroy()
  })

  it('@herkes: yazarın izni varsa etiket ve vurgu; yoksa düz yazı', async () => {
    let izinli = new Set(['u2'])
    const s = mountChat(alan, {
      source: sahteKaynak([satir(1, 'u2', 'toplantı @herkes'), satir(10, 'u3', 'bakın @everyone')], () => new Set()),
      profile: ben, members: [ben, ali], herkesAnabilir: (id) => izinli.has(id),
    })
    await bosalt()
    const m = (id) => alan.querySelector(`.message[data-id="${id}"]`)
    expect(m(1).classList.contains('mentioned')).toBe(true)
    expect(m(1).querySelector('.mention').textContent).toBe('@herkes')
    expect(m(1).querySelector('.mention').hasAttribute('data-profile-opener')).toBe(false)
    expect(m(10).classList.contains('mentioned')).toBe(false)
    expect(m(10).querySelector('.mention')).toBeNull()
    izinli = new Set()
    s.rollerDegisti()
    expect(m(1).classList.contains('mentioned')).toBe(false)
    s.destroy()
  })

  it('MANAGE_MESSAGES: başkasının mesajında 🗑️ ve 📌; izin gidince kalkar (getYetki her çizimde okunur)', async () => {
    let izinler = new Set(['MANAGE_MESSAGES'])
    const { channelSource } = await import('../src/data/messages.js')
    const kaynak = { ...channelSource({ id: 'c1', name: 'genel' }, { selfId: 'u1', getYetki: () => ({ has: (p) => izinler.has(p) }) }) }
    kaynak.fetch = async () => [satir(1, 'u2', 'selam')]
    kaynak.subscribe = () => () => {}
    kaynak.joinTyping = () => ({ typing() {}, stopped() {}, clear() {}, leave: async () => {} })
    kaynak.fetchPinned = async () => []
    const s = mountChat(alan, { source: kaynak, profile: ben, members: [ben, ali] })
    await bosalt()
    const dugme = (act) => alan.querySelector(`.message[data-id="1"] [data-act="${act}"]`)
    expect(dugme('sil')).not.toBeNull()
    izinler = new Set()
    s.rollerDegisti()
    expect(dugme('sil')).toBeNull()
    s.destroy()
  })
})

describe('üye listesi: roller', () => {
  const roles = [
    { id: 'r0', name: '@herkes', position: 0, is_default: true, permissions: [], color: null, hoist: false },
    { id: 'r1', name: 'Mod', position: 1, is_default: false, permissions: [], color: 'yesil', hoist: true },
  ]
  it('ayrı gösterilen rol kendi başlığında; ad rol renginde', () => {
    const panel = document.createElement('div')
    const presence = new Map([['u1', { status: 'online' }], ['u2', { status: 'online' }]])
    renderMemberList(panel, { members: [ben, ali, { id: 'u3', username: 'can', color: '#000' }], presence, roles, memberRoles: [{ user_id: 'u2', role_id: 'r1' }] })
    expect([...panel.querySelectorAll('.member-group-title')].map((b) => b.textContent)).toEqual(['Mod — 1', 'Çevrimiçi — 1', 'Çevrimdışı — 1'])
    const adi = [...panel.querySelectorAll('.member-name')].find((e) => e.textContent === 'ali')
    expect(adi.style.color).toBe('var(--rol-yesil)')
  })
  it('rol verilmezse eski gruplama', () => {
    const panel = document.createElement('div')
    renderMemberList(panel, { members: [ben, ali], presence: new Map([['u1', { status: 'online' }]]) })
    expect([...panel.querySelectorAll('.member-group-title')].map((b) => b.textContent)).toEqual(['Çevrimiçi — 1', 'Çevrimdışı — 1'])
  })
})

describe('kanal listesi: MANAGE_CHANNELS', () => {
  const ctx = (ek) => ({
    server: { id: 's1', name: 'S', owner_id: 'sahip' }, channels: [{ id: 'k1', name: 'genel', kind: 'text', position: 0 }],
    profile: ben, selectedChannelId: 'k1', handlers: {}, ...ek,
  })
  it('yetki verilince sahip olmayanda da + kanal ve ⚙; yetki false ise sahipte bile yok; verilmezse sahiplik', () => {
    const panel = document.createElement('div')
    renderChannelList(panel, ctx({ canManageChannels: true }))
    expect(panel.querySelector('.channel-gear')).not.toBeNull()
    expect([...panel.querySelectorAll('.link-btn')].some((b) => b.textContent === '+ kanal')).toBe(true)
    renderChannelList(panel, ctx({ canManageChannels: false, server: { id: 's1', name: 'S', owner_id: 'u1' } }))
    expect(panel.querySelector('.channel-gear')).toBeNull()
    renderChannelList(panel, ctx({}))
    expect(panel.querySelector('.channel-gear')).toBeNull()
  })
})

describe('profil kartı: roller ve çıkarma', () => {
  const mod = { id: 'r1', name: 'Mod', color: 'mavi' }
  const dj = { id: 'r2', name: 'DJ', color: null }
  it('yetkili: onay kutuları; değiştirince onToggle; hata olursa eski hâline döner', async () => {
    const onToggle = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('Bunu yapmaya yetkin yok.'))
    const kart = buildProfileCard({ person: ali, sunucu: { roller: [{ rol: mod, atanmis: true, degistirilebilir: true }, { rol: dj, atanmis: false, degistirilebilir: false }], onToggle } })
    document.body.appendChild(kart)
    const kutular = [...kart.querySelectorAll('.profile-card-role-check input')]
    expect(kutular.map((k) => [k.checked, k.disabled])).toEqual([[true, false], [false, true]])
    expect(kart.querySelector('.profile-card-role-list').getAttribute('role')).toBe('group')
    kutular[0].click()
    await bosalt()
    expect(onToggle).toHaveBeenCalledWith(mod, false)
    expect(kutular[0].checked).toBe(false)
    kutular[0].click()
    await bosalt()
    expect(kutular[0].checked).toBe(false) // başarısız: geri döndü
    expect(kart.querySelector('.profile-card-roles .profile-card-error').textContent).toBe('Bunu yapmaya yetkin yok.')
  })
  it('yetkisiz: yalnız atanmış rollerin rozetleri (rol renginde nokta); çıkarma yok', () => {
    const kart = buildProfileCard({ person: ali, sunucu: { roller: [{ rol: mod, atanmis: true, degistirilebilir: false }, { rol: dj, atanmis: false, degistirilebilir: false }] } })
    expect([...kart.querySelectorAll('.profile-card-role')].map((r) => r.textContent)).toEqual(['Mod'])
    expect(kart.querySelector('.profile-card-role .role-dot').style.background).toBe('var(--rol-mavi)')
    expect(kart.querySelector('input')).toBeNull()
    expect(kart.querySelector('.profile-card-kick')).toBeNull()
  })
  it('çıkarma düğmesi onKick çağırır; rol ve çıkarma yoksa bölüm yok', () => {
    const onKick = vi.fn()
    const kart = buildProfileCard({ person: ali, sunucu: { roller: [], onKick } })
    const b = kart.querySelector('.profile-card-kick')
    expect(b.textContent).toBe('Sunucudan çıkar')
    expect(b.className).toContain('danger')
    b.click()
    expect(onKick).toHaveBeenCalled()
    expect(buildProfileCard({ person: ali, sunucu: { roller: [] } }).querySelector('.profile-card-roles')).toBeNull()
  })
})
