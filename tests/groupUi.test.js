// @vitest-environment jsdom
// Grup DM arayüzü: sol sütundaki grup satırı (rozet, ad, "+", "Aramaya katıl (N)"), pencereler, sağ panel,
// grup araması akışı ve paneli, gelen kartın grup hâli, sohbette grup @bahsetmesi.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHomeSidebar } from '../src/ui/home.js'
import { grupRozeti, openCreateGroupDialog, openAddMemberDialog, confirmLeaveGroup, renderGroupPanel, GRUP_METINLERI } from '../src/ui/groupDm.js'
import { createGroupCallFlow, mountGroupCallPanel, grupAramaGorunumu, createGroupCallButton, groupCallTiming, GRUP_ARAMA_METINLERI } from '../src/ui/groupCall.js'
import { createIncomingCall } from '../src/ui/incomingCall.js'

const ben = { id: 'u0', username: 'berk', color: '#3be37a', avatar_url: null }
const ayla = { id: 'u1', username: 'ayla', color: '#ef5b9c', avatar_url: null }
const kerem = { id: 'u2', username: 'kerem', color: '#5b7cfa', avatar_url: null }
const can = { id: 'u3', username: 'can', color: null, avatar_url: null }
const grup = (ek = {}) => ({
  id: 'g1', isGroup: true, name: null, ownerId: 'u0', members: [ben, ayla, kerem], other: null,
  createdAt: '2026-11-01T00:00:00Z', lastMessageAt: null, unread: 0, canSend: true, muted: false, call: null, ...ek,
})
const bosalt = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0)) }

beforeEach(() => { document.body.innerHTML = '' })

describe('sol sütun', () => {
  it('grup satırı: rozet (ilk iki diğer üye), ad yoksa adlar virgülle, okunmamış etiketi', () => {
    const el = renderHomeSidebar({ dms: [grup({ unread: 2 })], selfId: 'u0', handlers: {} })
    const satir = el.querySelector('.dm-item')
    expect(satir.querySelector('.dm-name').textContent).toBe('ayla, kerem')
    const parcalar = [...satir.querySelectorAll('.group-badge-part')].map((p) => p.textContent)
    expect(parcalar).toEqual(['A', 'K'])
    expect(satir.getAttribute('aria-label')).toBe('ayla, kerem, 2 okunmamış mesaj')
  })

  it('"+" Grup oluştur yalnız handler verilince; tıklanınca çağrılır', () => {
    expect(renderHomeSidebar({ dms: [], handlers: {} }).querySelector('.dm-group-create')).toBeNull()
    const onCreateGroup = vi.fn()
    const el = renderHomeSidebar({ dms: [], handlers: { onCreateGroup } })
    const b = el.querySelector('.dm-group-create')
    expect(b.getAttribute('aria-label')).toBe('Grup oluştur')
    b.click()
    expect(onCreateGroup).toHaveBeenCalled()
  })

  it('arama sürüyorsa "Aramaya katıl (N)"; sessiz grup soluk', () => {
    const onJoinCall = vi.fn()
    const el = renderHomeSidebar({ dms: [grup({ name: 'Oyun', muted: true, call: { id: 'k1', count: 3 } })], selfId: 'u0', handlers: { onJoinCall } })
    const katil = el.querySelector('.dm-join-call')
    expect(katil.textContent).toBe('Aramaya katıl (3)')
    katil.click()
    expect(onJoinCall).toHaveBeenCalledWith(expect.objectContaining({ id: 'g1' }))
    expect(el.querySelector('.dm-item').classList.contains('muted')).toBe(true)
    expect(el.querySelector('.dm-name').textContent).toBe('Oyun')
  })

  it('bire bir satır aynen kalır (avatar + durum noktası)', () => {
    const el = renderHomeSidebar({ dms: [{ id: 't1', other: ayla, unread: 0 }], handlers: {} })
    expect(el.querySelector('.dm-name').textContent).toBe('ayla')
    expect(el.querySelector('.group-badge')).toBeNull()
    expect(el.querySelector('.status-dot')).not.toBeNull()
  })
})

describe('pencereler', () => {
  it('Grup oluştur: en az 2 arkadaş seçilmeli; seçilenler ve ad gönderilir', async () => {
    const onCreate = vi.fn(async () => {})
    openCreateGroupDialog({ friends: [ayla, kerem, can], onCreate })
    const kutular = [...document.querySelectorAll('.group-picker input[type=checkbox]')]
    expect(kutular).toHaveLength(3)
    kutular[0].click()
    kutular[0].dispatchEvent(new Event('change'))
    const ana = [...document.querySelectorAll('.modal-foot button')].at(-1)
    ana.click()
    await bosalt()
    expect(onCreate).not.toHaveBeenCalled()
    expect(document.querySelector('.modal-card .error').textContent).toBe(GRUP_METINLERI.enAz)
    kutular[1].click()
    document.querySelector('.modal-card input[type=text]').value = 'Oyun'
    ana.click()
    await bosalt()
    expect(onCreate).toHaveBeenCalledWith(['u1', 'u2'], 'Oyun')
    expect(document.querySelector('.modal-card')).toBeNull()
  })

  it('Grup oluştur: 9 kişi seçilince diğerleri kapanır (kendin dahil 10)', () => {
    const arkadaslar = Array.from({ length: 11 }, (_, i) => ({ id: `f${i}`, username: `kisi${i}`, color: null, avatar_url: null }))
    openCreateGroupDialog({ friends: arkadaslar, onCreate: async () => {} })
    const kutular = [...document.querySelectorAll('.group-picker input[type=checkbox]')]
    for (const k of kutular.slice(0, 9)) { k.checked = true; k.dispatchEvent(new Event('change')) }
    expect(kutular.slice(9).every((k) => k.disabled)).toBe(true)
    expect(document.querySelector('.group-count').textContent).toBe('10/10 kişi (sen dahil)')
  })

  it('arkadaş yetmiyorsa bilgi yazısı, ana düğme yok', () => {
    openCreateGroupDialog({ friends: [ayla], onCreate: async () => {} })
    expect(document.querySelector('.group-hint').textContent).toBe(GRUP_METINLERI.arkadasYok)
    expect([...document.querySelectorAll('.modal-foot button')]).toHaveLength(1)
  })

  it('Üye ekle: hata (gizli kod metni) pencerede yazar', async () => {
    const onAdd = vi.fn(async () => { throw new Error('Bu kişi eklenemedi.') })
    openAddMemberDialog({ candidates: [can], onAdd })
    document.querySelector('.group-picker input').click()
    ;[...document.querySelectorAll('.modal-foot button')].at(-1).click()
    await bosalt()
    expect(onAdd).toHaveBeenCalledWith('u3')
    expect(document.querySelector('.modal-card .error').textContent).toBe('Bu kişi eklenemedi.')
  })

  it('Gruptan ayrıl onay ister (kırmızı düğme)', async () => {
    const onLeave = vi.fn(async () => {})
    confirmLeaveGroup({ ad: 'Oyun', onLeave })
    const ana = [...document.querySelectorAll('.modal-foot button')].at(-1)
    expect(ana.className).toContain('danger')
    expect(document.querySelector('.confirm-text').textContent).toContain('Oyun grubundan ayrılmak')
    ana.click()
    await bosalt()
    expect(onLeave).toHaveBeenCalled()
  })
})

describe('sağ panel', () => {
  it('kurucu: üyelerde "Çıkar" (kendinde yok), 👑 kurucuda; işler', () => {
    const panel = document.createElement('div')
    const onRemove = vi.fn()
    const onLeave = vi.fn()
    renderGroupPanel(panel, { thread: grup(), selfId: 'u0', handlers: { onRemove, onLeave } })
    const cikar = [...panel.querySelectorAll('.group-remove')]
    expect(cikar.map((b) => b.getAttribute('aria-label'))).toEqual(['ayla kişisini gruptan çıkar', 'kerem kişisini gruptan çıkar'])
    cikar[0].click()
    expect(onRemove).toHaveBeenCalledWith(ayla)
    expect(panel.querySelectorAll('.group-owner')).toHaveLength(1)
    panel.querySelector('.group-action.ayril').click()
    expect(onLeave).toHaveBeenCalled()
    expect(panel.querySelector('.member-section-title').textContent).toBe('ÜYELER — 3')
  })

  it('kurucu olmayan "Çıkar" görmez; sessizde "Sesi aç"; 10 kişide "Üye ekle" kapalı', () => {
    const panel = document.createElement('div')
    const on = Array.from({ length: 10 }, (_, i) => ({ id: `x${i}`, username: `k${i}`, color: null, avatar_url: null }))
    renderGroupPanel(panel, { thread: grup({ ownerId: 'x1', members: [{ ...ben, id: 'x0' }, ...on.slice(1)], muted: true }), selfId: 'x0' })
    expect(panel.querySelector('.group-remove')).toBeNull()
    expect(panel.querySelector('.group-action.sessiz').textContent).toBe('Sesi aç')
    expect(panel.querySelector('.group-action.ekle').disabled).toBe(true)
  })

  it('rozet ekran okuyucudan gizli; yazılar textContent', () => {
    const r = grupRozeti({ members: [ben, { ...ayla, username: '<b>x</b>' }] }, 'u0')
    expect(r.getAttribute('aria-hidden')).toBe('true')
    expect(r.innerHTML).not.toContain('<b>')
  })
})

// Sahte ses oturumu (callPanel testlerindeki kalıp)
function sahteOturum() {
  const dinle = { change: new Set(), tracks: new Set(), speaking: new Set() }
  const st = { status: 'connected', muted: false, deafened: false, listenOnly: false, speaking: new Set() }
  let bagli = []
  return {
    st,
    getState: () => st,
    on(ad, cb) { dinle[ad].add(cb); return () => dinle[ad].delete(cb) },
    connectedPeers: () => bagli,
    getPeerState: (id) => (id === 'u1' ? { muted: true } : null),
    esler(ids) { bagli = ids; for (const cb of dinle.tracks) cb() },
    dinleyiciSayisi: () => dinle.change.size + dinle.tracks.size + dinle.speaking.size,
  }
}

function akisKur(ek = {}) {
  const oturum = sahteOturum()
  const deps = {
    selfId: 'u0',
    startGroupCall: vi.fn(async () => ({ id: 'k1', status: 'ringing', caller: 'u0' })),
    joinGroupCall: vi.fn(async () => ({ id: 'k1', status: 'active', caller: 'u1' })),
    leaveGroupCall: vi.fn(async () => {}),
    pingGroupCall: vi.fn(async () => true),
    beforeJoin: vi.fn(async () => {}),
    enter: vi.fn(() => oturum),
    exit: vi.fn(() => Promise.resolve()),
    toast: vi.fn(),
    beep: vi.fn(),
    startTone: vi.fn(() => vi.fn()),
    onChange: vi.fn(),
    ...ek,
  }
  return { akis: createGroupCallFlow(deps), deps, oturum }
}

describe('grup araması akışı', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('başlatan hemen sese girer; 30 sn kimse katılmazsa "Cevap yok" (timeout) ile biter', async () => {
    const { akis, deps } = akisKur()
    await akis.baslat(grup())
    expect(deps.beforeJoin).toHaveBeenCalled()
    expect(deps.enter).toHaveBeenCalledWith(expect.objectContaining({ id: 'k1', isGroup: true }), expect.objectContaining({ id: 'g1' }))
    expect(akis.bilgi()).toMatchObject({ faz: 'aramada', bekliyor: true })
    expect(deps.startTone).toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(groupCallTiming.ringMs)
    expect(deps.leaveGroupCall).toHaveBeenCalledWith('k1', 'timeout')
    expect(deps.exit).toHaveBeenCalledWith(null)
    expect(deps.toast).toHaveBeenCalledWith(GRUP_ARAMA_METINLERI.cevapYok, 'bilgi')
    expect(akis.bilgi()).toBeNull()
  })

  it('biri katılınca (active olayı) bekleme biter; son olay "ended" ise yerelde kapanır', async () => {
    const { akis, deps } = akisKur()
    await akis.baslat(grup())
    akis.olay({ callId: 'k1', threadId: 'g1', status: 'active', count: 2 })
    expect(akis.bilgi().bekliyor).toBe(false)
    await vi.advanceTimersByTimeAsync(groupCallTiming.ringMs)
    expect(deps.leaveGroupCall).not.toHaveBeenCalled()
    akis.olay({ callId: 'k1', threadId: 'g1', status: 'ended', count: 0 })
    expect(deps.exit).toHaveBeenCalledWith(null)
    expect(akis.bilgi()).toBeNull()
  })

  it('Ayrıl: kimse katılmadıysa cancel, katıldıysa hangup', async () => {
    const a = akisKur()
    await a.akis.baslat(grup())
    a.akis.kapat()
    expect(a.deps.exit).toHaveBeenCalledWith('cancel')
    const b = akisKur()
    await b.akis.katil(grup(), 'k1')
    expect(b.deps.joinGroupCall).toHaveBeenCalledWith('k1')
    expect(b.akis.bilgi().bekliyor).toBe(false)
    b.akis.kapat()
    expect(b.deps.exit).toHaveBeenCalledWith('hangup')
  })

  it('hata metinleri; bitmiş aramaya katılınca "Arama sona erdi."', async () => {
    const e = Object.assign(new Error('Zaten bir aramadasın.'), { code: 'ALREADY_IN_CALL' })
    const a = akisKur({ startGroupCall: vi.fn(async () => { throw e }) })
    await a.akis.baslat(grup())
    expect(a.deps.toast).toHaveBeenCalledWith('Zaten bir aramadasın.', 'bilgi')
    expect(a.akis.bilgi()).toBeNull()
    const b = akisKur({ joinGroupCall: vi.fn(async () => ({ id: 'k1', status: 'ended' })) })
    await b.akis.katil(grup(), 'k1')
    expect(b.deps.toast).toHaveBeenCalledWith(GRUP_ARAMA_METINLERI.bitti)
    expect(b.deps.enter).not.toHaveBeenCalled()
  })

  it('canlılık: ping false dönerse aramadan çıkılır', async () => {
    const { akis, deps } = akisKur({ pingGroupCall: vi.fn(async () => false) })
    await akis.katil(grup(), 'k1')
    await vi.advanceTimersByTimeAsync(groupCallTiming.pingMs)
    expect(deps.exit).toHaveBeenCalledWith(null)
    expect(akis.bilgi()).toBeNull()
  })

  it('sesKapandi: sayaçlar ve oturum dinleyicileri bırakılır', async () => {
    const { akis, oturum } = akisKur()
    await akis.katil(grup(), 'k1')
    expect(oturum.dinleyiciSayisi()).toBeGreaterThan(0)
    akis.sesKapandi('k1')
    expect(akis.bilgi()).toBeNull()
    expect(oturum.dinleyiciSayisi()).toBe(0)
  })
})

describe('grup araması paneli', () => {
  it('ızgara: biz + bağlı üyeler; susturma simgesi; Aranıyor… yazısı; Ayrıl düğmesi', async () => {
    vi.useFakeTimers()
    const { akis, oturum } = akisKur()
    await akis.baslat(grup())
    oturum.esler(['u1'])
    const host = document.createElement('div')
    const onLeave = vi.fn()
    const panel = mountGroupCallPanel(host, { onLeave })
    panel.ciz(grupAramaGorunumu(akis.bilgi(), ben, [ben, ayla, kerem]))
    expect([...host.querySelectorAll('.group-call-name')].map((x) => x.textContent)).toEqual(['berk', 'ayla'])
    expect(host.querySelectorAll('.call-avatar-state')).toHaveLength(1) // ayla susturmuş
    expect(host.querySelector('.call-status').textContent).toBe(GRUP_ARAMA_METINLERI.bekleniyor)
    host.querySelector('.call-hangup').click()
    expect(onLeave).toHaveBeenCalled()
    panel.ciz(null)
    expect(host.hidden).toBe(true)
    akis.sesKapandi('k1')
    vi.useRealTimers()
  })

  it('başlık düğmesi: Grubu ara / Aramaya katıl (N) / Aramadasın / başka aramada pasif', () => {
    const onStart = vi.fn()
    const onJoin = vi.fn()
    const { button, update } = createGroupCallButton({ onStart, onJoin })
    expect(button.getAttribute('aria-label')).toBe('Grubu ara')
    button.click()
    expect(onStart).toHaveBeenCalled()
    update({ call: { id: 'k1', count: 2 } })
    expect(button.getAttribute('aria-label')).toBe('Aramaya katıl (2)')
    button.click()
    expect(onJoin).toHaveBeenCalledWith({ id: 'k1', count: 2 })
    update({ inThisCall: true })
    expect(button.getAttribute('aria-label')).toBe('Aramadasın')
    expect(button.getAttribute('aria-disabled')).toBe('true')
    update({ call: { id: 'k1', count: 2 }, inOtherCall: true })
    expect(button.dataset.tip).toBe('Zaten bir aramadasın.')
    button.click()
    expect(onJoin).toHaveBeenCalledTimes(1)
  })
})

describe('gelen kart: grup', () => {
  it('"Grup adı · berk arıyor"; Reddet sunucuya gitmez; Kabul et answer (join) ve grup onAccept', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const endCall = vi.fn(async () => {})
    const onAccept = vi.fn()
    const kart = createIncomingCall({ host: () => host, answerCall: vi.fn(), endCall, onAccept, toast: vi.fn() })
    const grupKabul = vi.fn()
    const answer = vi.fn(async () => ({ id: 'k1', status: 'active' }))
    const ayar = { title: 'Oyun · berk arıyor', person: ben, answer, leave: vi.fn(), onAccept: grupKabul }
    expect(kart.goster({ callId: 'k1', thread: grup(), zil: false, group: ayar })).toBe(true)
    expect(host.querySelector('.incoming-call-title').textContent).toBe('Oyun · berk arıyor')
    host.querySelector('.incoming-decline').click()
    expect(endCall).not.toHaveBeenCalled()
    expect(host.querySelector('.incoming-call')).toBeNull()
    kart.goster({ callId: 'k2', thread: grup(), zil: false, group: ayar })
    host.querySelector('.incoming-accept').click()
    await bosalt()
    expect(answer).toHaveBeenCalledWith('k2')
    expect(grupKabul).toHaveBeenCalledWith({ id: 'k2', status: 'active', isGroup: true }, expect.objectContaining({ id: 'g1' }))
    expect(onAccept).not.toHaveBeenCalled()
    kart.destroy()
  })
})

describe('K8: grup araması bildirimi', () => {
  it('bildirArama metin verilince kartla aynı yazıyı gösterir; verilmezse "Ad seni arıyor"', async () => {
    const { createNotifier } = await import('../src/notify.js')
    const gosterilen = []
    const n = createNotifier({ deps: { goster: (b) => { gosterilen.push(b); return true }, sesCal: () => {}, odakla: () => {} } })
    n.bildirArama({ id: 'k1', ad: 'Oyun', metin: 'Oyun · berk arıyor' })
    n.bildirArama({ id: 'c2', ad: 'ali' })
    expect(gosterilen.map((b) => b.metin)).toEqual(['Oyun · berk arıyor', 'ali seni arıyor'])
    n.destroy()
  })
})
