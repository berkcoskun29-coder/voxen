// @vitest-environment jsdom
// Auth testleri: Supabase istemcisi sahte nesneyle değiştirilir, ağ kullanılmaz.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const fake = vi.hoisted(() => ({ calls: {} }))

vi.mock('../src/lib/supabase.js', () => {
  const insert = vi.fn(async () => ({ error: null }))
  const update = vi.fn(() => ({ eq: vi.fn(async () => ({ error: null })) }))
  const upload = vi.fn(async () => ({ error: null }))
  fake.insert = insert
  fake.update = update
  fake.upload = upload
  fake.rpc = vi.fn(async () => ({ data: true, error: null }))
  fake.signUp = vi.fn(async () => ({ data: { user: { id: 'u1' }, session: {} }, error: null }))
  fake.getSession = vi.fn(async () => ({ data: { session: { user: { id: 'u1' } } } }))
  return {
    supabase: {
      rpc: (...a) => fake.rpc(...a),
      auth: {
        signUp: (...a) => fake.signUp(...a),
        signInWithPassword: vi.fn(async () => ({ data: { user: { id: 'u1' } }, error: null })),
        signOut: vi.fn(async () => ({ error: null })),
        getSession: (...a) => fake.getSession(...a),
        onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe() {} } } })),
      },
      from: () => ({ insert, update }),
      storage: {
        from: () => ({
          upload,
          getPublicUrl: () => ({ data: { publicUrl: 'https://x/avatars/u1.webp' } }),
        }),
      },
    },
  }
})

import { signUp, uploadAvatar, AVATAR_COLORS } from '../src/auth/auth.js'
import { renderAuthView } from '../src/auth/authView.js'
import { renderCompleteProfile } from '../src/auth/profileModal.js'

beforeEach(() => {
  fake.insert.mockClear()
  fake.signUp.mockClear()
  fake.upload.mockClear()
  fake.rpc.mockClear()
  fake.rpc.mockImplementation(async () => ({ data: true, error: null }))
  fake.insert.mockImplementation(async () => ({ error: null }))
})

describe('signUp', () => {
  it('signUp profil satırını rastgele bir renkle oluşturur', async () => {
    const r = await signUp('a@b.com', 'sifre1234', 'berk')
    expect(r.user.id).toBe('u1')
    const row = fake.insert.mock.calls[0][0]
    expect(row.id).toBe('u1')
    expect(row.username).toBe('berk')
    expect(AVATAR_COLORS).toContain(row.color)
  })

  it('kullanıcı adı 3 karakterden kısaysa istek atmadan hata döner', async () => {
    const r = await signUp('a@b.com', 'sifre1234', 'ab')
    expect(r.error).toBeTruthy()
    expect(fake.signUp).not.toHaveBeenCalled()
    expect(fake.rpc).not.toHaveBeenCalled()
  })

  it('şifre 8 karakterden kısaysa hata döner', async () => {
    const r = await signUp('a@b.com', '1234567', 'berk')
    expect(r.error).toBeTruthy()
    expect(fake.signUp).not.toHaveBeenCalled()
  })

  it('kullanıcı adı alınmışsa kayıttan önce hata döner', async () => {
    fake.rpc.mockImplementation(async () => ({ data: false, error: null }))
    const r = await signUp('a@b.com', 'sifre1234', 'berk')
    expect(r.error).toBe('Bu kullanıcı adı alınmış')
    expect(fake.signUp).not.toHaveBeenCalled()
  })

  it('yarış durumunda (unique ihlali) aynı hatayı döner', async () => {
    fake.insert.mockImplementation(async () => ({ error: { code: '23505' } }))
    const r = await signUp('a@b.com', 'sifre1234', 'berk')
    expect(r.error).toBe('Bu kullanıcı adı alınmış')
  })
})

describe('yarış durumunda yönlendirme', () => {
  it('oturum açık + unique ihlali: needsProfile döner', async () => {
    fake.insert.mockImplementation(async () => ({ error: { code: '23505' } }))
    const r = await signUp('a@b.com', 'sifre1234', 'berk')
    expect(r).toEqual({ error: 'Bu kullanıcı adı alınmış', needsProfile: true })
  })

  it('görünüm onDone(mesaj) çağırır, "Profilini tamamla" formu hatayı gösterir', async () => {
    fake.insert.mockImplementation(async () => ({ error: { code: '23505' } }))
    const kap = document.createElement('div')
    // onDone, main.js'teki goster gibi: mesajı tamamlama formuna taşır
    const onDone = vi.fn((mesaj) => renderCompleteProfile(kap, 'u1', () => {}, mesaj))
    renderAuthView(kap, onDone)
    kap.querySelector('[data-mod=kayit]').click()
    const f = kap.querySelector('form').elements
    f.username.value = 'berk'; f.email.value = 'a@b.com'; f.password.value = 'sifre1234'
    kap.querySelector('form').dispatchEvent(new Event('submit', { cancelable: true }))
    await vi.waitFor(() => expect(onDone).toHaveBeenCalledWith('Bu kullanıcı adı alınmış'))
    expect(kap.querySelector('h1').textContent).toBe('Profilini tamamla')
    expect(kap.querySelector('.error').textContent).toBe('Bu kullanıcı adı alınmış')
  })
})

describe('uploadAvatar', () => {
  it('uploadAvatar 1 MB üstü ya da resim olmayan dosyayı reddeder', async () => {
    const buyuk = new File([new Uint8Array(1024 * 1024 + 1)], 'a.png', { type: 'image/png' })
    await expect(uploadAvatar(buyuk)).rejects.toThrow(/1 MB/)
    const metin = new File(['merhaba'], 'a.txt', { type: 'text/plain' })
    await expect(uploadAvatar(metin)).rejects.toThrow(/resim/)
    expect(fake.upload).not.toHaveBeenCalled()
  })

  it('geçerli resmi webp olarak yükler ve adresi döner', async () => {
    // Canvas ve createImageBitmap jsdom'da yok, sahtesini koyuyoruz
    vi.stubGlobal('createImageBitmap', async () => ({ width: 512, height: 512, close() {} }))
    const ctx = { drawImage: vi.fn() }
    let canvasBoyut
    HTMLCanvasElement.prototype.getContext = function () { canvasBoyut = [this.width, this.height]; return ctx }
    HTMLCanvasElement.prototype.toBlob = function (cb, type) { cb(new Blob(['x'], { type })) }
    const f = new File(['x'], 'a.png', { type: 'image/png' })
    const url = await uploadAvatar(f)
    expect(canvasBoyut).toEqual([256, 256])
    expect(fake.upload.mock.calls[0][0]).toBe('u1.webp')
    expect(fake.upload.mock.calls[0][2].upsert).toBe(true)
    expect(url).toMatch(/^https:\/\/x\/avatars\/u1\.webp\?v=\d+$/)
  })
})
