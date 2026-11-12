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
      insert: async (satir) => { fake.inserts?.push(satir); return { error: null } },
      then: (res) => res({ data: fake.rows[tablo] ?? [], error: null }),
    }
    return zincir
  })
  const kanal = { on: () => kanal, subscribe: () => kanal }
  return { supabase: { rpc: (...a) => fake.rpc(...a), from: (...a) => fake.from(...a), channel: () => kanal, removeChannel: () => {} } }
})

import { parseInviteInput, inviteFromHash } from '../src/ui/invite.js'
import { startApp } from '../src/ui/app.js'

// Kutunun altındaki hata satırı (aria-describedby ile bağlı .field-error)
const kutuHatasi = (input) => {
  const idler = (input.getAttribute('aria-describedby') ?? '').split(' ')
  return idler.map((i) => document.getElementById(i)).find((e) => e?.classList.contains('field-error'))?.textContent ?? null
}

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

  it('etiket kutuya bağlı (label for)', async () => {
    const input = await ac()
    expect(document.querySelector(`.modal-back label[for="${input.id}"]`).textContent).toBe('Davet linki veya kodu')
  })

  it('link yapıştırılınca joinByInvite çağrılır ve sunucu seçilir', async () => {
    const input = await ac()
    expect(document.querySelector('.modal-back h2').textContent).toBe('Sunucuya katıl')
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
    await vi.waitFor(() => expect(kutuHatasi(input)).toBe('Bu davet bulunamadı. Linki yeniden kopyalayıp yapıştır.'))
    expect(input.getAttribute('aria-invalid')).toBe('true')
    expect(fake.rpc).not.toHaveBeenCalled()
  })

  it('bozuk linkte hata görünür, RPC çağrılmaz', async () => {
    const input = await ac()
    fake.rpc.mockClear()
    input.value = 'https://x/#/davet/%E0%A4%A'
    ;[...document.querySelectorAll('.modal-back button')].find((b) => b.textContent === 'Katıl').click()
    await vi.waitFor(() => expect(kutuHatasi(input)).toBe('Bu davet bulunamadı. Linki yeniden kopyalayıp yapıştır.'))
    expect(input.getAttribute('aria-invalid')).toBe('true')
    expect(fake.rpc).not.toHaveBeenCalled()
  })

  it('RPC hatası modalda gösterilir', async () => {
    const input = await ac()
    fake.rpc.mockImplementation(async () => ({ data: null, error: { message: 'x' } }))
    input.value = 'YANLIS'
    ;[...document.querySelectorAll('.modal-back button')].find((b) => b.textContent === 'Katıl').click()
    await vi.waitFor(() => expect(kutuHatasi(input)).toBe('Bu davet bulunamadı. Linki yeniden kopyalayıp yapıştır.'))
    expect(input.getAttribute('aria-invalid')).toBe('true')
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

// U08: kanal ekle penceresinde tür için iki seçim kartı
describe('Kanal ekle penceresi', () => {
  beforeEach(() => {
    fake.inserts = []
    fake.rows = {
      servers: [{ id: 'srv1', name: 'Arkadaşlar', owner_id: 'u1', invite_code: 'KOD' }],
      channels: [{ id: 'c1', server_id: 'srv1', name: 'genel', kind: 'text', position: 0 }],
    }
    sessionStorage.clear(); localStorage.clear(); location.hash = ''
    document.body.innerHTML = '<div id="app"></div>'
  })
  async function ac(tur) {
    await startApp(document.querySelector('#app'), profil)
    await vi.waitFor(() => expect(document.querySelector(`[data-odak="kanal-ekle-${tur}"]`)).not.toBeNull())
    document.querySelector(`[data-odak="kanal-ekle-${tur}"]`).click()
    return document.querySelector('.modal-back')
  }
  const secili = (p) => p.querySelector('[role=radio][aria-checked=true]')

  it('açılır liste yok; radiogroup içinde Yazılı ve Sesli kartları; sesli bölümden açılınca Sesli seçili', async () => {
    const p = await ac('voice')
    expect(p.querySelector('select')).toBeNull()
    const grup = p.querySelector('[role=radiogroup]')
    expect(grup.getAttribute('aria-labelledby')).toBeTruthy()
    const kartlar = [...grup.querySelectorAll('[role=radio]')]
    expect(kartlar.map((k) => k.querySelector('.kind-name').textContent)).toEqual(['Yazılı', 'Sesli'])
    expect(secili(p).dataset.tur).toBe('voice')
    // Seçili kart Tab sırasında, diğeri değil (roving tabindex)
    expect(kartlar.map((k) => k.tabIndex)).toEqual([-1, 0])
    // Odak kanal adı kutusunda; kutunun başında hoparlör simgesi
    expect(document.activeElement).toBe(p.querySelector('input'))
    expect(p.querySelector('.input-prefix svg')).not.toBeNull()
  })

  it('tıklama ve ok tuşları seçimi değiştirir; ad kutusunun simgesi değişir', async () => {
    const p = await ac('text')
    expect(secili(p).dataset.tur).toBe('text')
    expect(p.querySelector('.input-prefix').textContent).toBe('#')
    p.querySelector('[data-tur=voice]').click()
    expect(secili(p).dataset.tur).toBe('voice')
    expect(p.querySelector('.input-prefix svg')).not.toBeNull()
    secili(p).focus()
    secili(p).dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }))
    expect(secili(p).dataset.tur).toBe('text')
    expect(document.activeElement).toBe(secili(p))
    secili(p).dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }))
    expect(secili(p).dataset.tur).toBe('voice')
  })

  it('boş adda hata kutunun altında; seçili türle kanal oluşturulur', async () => {
    const p = await ac('text')
    const input = p.querySelector('input')
    expect(p.querySelector(`label[for="${input.id}"]`).textContent).toBe('Kanal adı')
    ;[...p.querySelectorAll('button')].find((b) => b.textContent === 'Oluştur').click()
    await vi.waitFor(() => expect(kutuHatasi(input)).toBe('Kanal adı boş olamaz. Bir ad yaz (en fazla 30 karakter).'))
    expect(input.getAttribute('aria-invalid')).toBe('true')
    p.querySelector('[data-tur=voice]').click()
    input.value = 'Lobi'
    ;[...p.querySelectorAll('button')].find((b) => b.textContent === 'Oluştur').click()
    await vi.waitFor(() => expect(document.querySelector('.modal-back')).toBeNull())
    expect(fake.inserts.at(-1)).toMatchObject({ server_id: 'srv1', name: 'Lobi', kind: 'voice' })
  })
})

describe('Sunucu oluştur penceresi', () => {
  it('boş adda hata kutunun altında ve çözüm söyler', async () => {
    fake.rows = { servers: [], channels: [] }
    sessionStorage.clear(); localStorage.clear(); location.hash = ''
    document.body.innerHTML = '<div id="app"></div>'
    await startApp(document.querySelector('#app'), profil)
    await vi.waitFor(() => expect(document.querySelector('.welcome-create')).not.toBeNull())
    document.querySelector('.welcome-create').click()
    const input = document.querySelector('.modal-back input')
    expect(document.querySelector(`.modal-back label[for="${input.id}"]`).textContent).toBe('Sunucu adı')
    ;[...document.querySelectorAll('.modal-back button')].find((b) => b.textContent === 'Oluştur').click()
    await vi.waitFor(() => expect(kutuHatasi(input)).toBe('Sunucu adı boş olamaz. Bir ad yaz (en fazla 40 karakter).'))
    expect(input.getAttribute('aria-invalid')).toBe('true')
  })
})
