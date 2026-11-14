// @vitest-environment jsdom
// Ekler arayüzü (010) ve v0.7.0 küçük düzeltmeleri (K-1, K-3, K-4, K-6): mountChat sahte bir "kaynak"
// nesnesiyle kurulur; yükleme/adres/indirme (data/attachments.js) sahte. Ağ yok.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const fake = vi.hoisted(() => ({ profiles: [] }))
vi.mock('../src/lib/supabase.js', () => ({
  supabase: {
    from: () => {
      const d = { ids: [] }
      const z = {
        select: () => z,
        in: (_k, ids) => { d.ids = ids; return z },
        then: (res) => Promise.resolve({ data: fake.profiles.filter((p) => d.ids.includes(p.id)), error: null }).then(res),
      }
      return z
    },
    rpc: async () => ({ data: null, error: null }),
    channel: () => ({ on() { return this }, subscribe() { return this } }),
    removeChannel: async () => {},
  },
}))
vi.mock('../src/data/attachments.js', () => {
  fake.uploadFile = vi.fn(async (_y, _b, _t, { onProgress } = {}) => { onProgress?.(1) })
  fake.kullanimim = vi.fn(async () => 0)
  fake.indir = vi.fn(async () => {})
  return {
    uploadFile: (...a) => fake.uploadFile(...a),
    kullanimim: (...a) => fake.kullanimim(...a),
    indir: (...a) => fake.indir(...a),
    hazirAdres: (yol) => `https://imza/${yol}`,
    adresAl: async (yol) => `https://imza/${yol}`,
    sendMessageWithAttachments: vi.fn(),
    sendDmWithAttachments: vi.fn(),
    fetchAttachments: vi.fn(async () => []),
    removeFiles: vi.fn(async () => {}),
  }
})

import { mountChat } from '../src/ui/chatView.js'
import { resimHazirla, kucultmeBoyutu, onizlemeBoyutu, goruntuleyiciAc } from '../src/ui/attachments.js'
import { sabitListesiAc } from '../src/ui/pins.js'
import { KOTA, YER_TUTUCU } from '../src/data/ekKurallari.js'

const ben = { id: 'u1', username: 'berk', color: '#5b7cfa', avatar_url: null }
const ali = { id: 'u2', username: 'ali', color: '#e05b5b', avatar_url: null }
const ms = (id, author, content = `m${id}`, ek = {}) => ({
  id, channel_id: 'c1', author_id: author, content, edited_at: null, deleted_at: null,
  created_at: new Date(Date.UTC(2026, 10, 14, 10, 0) + id * 60000).toISOString(), ...ek,
})
const bosalt = async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0)) }
const mesaj = (id) => document.querySelector(`.message[data-id="${id}"]`)
const tus = (el, key, extra = {}) => el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...extra }))
const dosya = (ad, tur, boyut = 10) => {
  const f = new File(['x'.repeat(Math.min(boyut, 64))], ad, { type: tur })
  if (boyut > 64) Object.defineProperty(f, 'size', { value: boyut })
  return f
}
const resimEk = (id, ad = `r${id}.png`, ek = {}) => ({ id, path: `k/c1/u2/x-${ad}`, name: ad, mime: 'image/png', size: 100, width: 800, height: 600, uploader: 'u2', ...ek })

function kaynakKur(satirlar, ek = {}) {
  const k = {
    kind: 'channel', id: 'c1', title: 'genel', placeholder: 'yaz', other: null, canSend: true,
    satirlar,
    fetch: vi.fn(async (before, { limit = 50 } = {}) => {
      const s = k.satirlar.filter((m) => !m.deleted_at && (before == null || m.id < before))
      return s.slice(-limit)
    }),
    send: vi.fn(async (content, opts) => ({ ok: true, message: ms(100, 'u1', content, { reply_to: opts?.replyTo ?? null }) })),
    edit: vi.fn(), remove: vi.fn(async () => {}),
    subscribe: vi.fn((h) => { k.olaylar = h; return () => {} }),
    joinTyping: () => ({ typing() {}, stopped() {}, clear() {}, leave: async () => {} }),
    markRead: () => {},
    canDelete: (m) => m.author_id === 'u1',
    canEdit: (m) => m.author_id === 'u1',
    react: vi.fn(async () => {}),
    pin: vi.fn(async () => {}),
    fetchPinned: vi.fn(async () => []),
    fetchByIds: vi.fn(async () => []),
    canReact: () => true,
    canPin: () => true,
    ekKlasoru: 'k/c1',
    sendWithAttachments: vi.fn(async (content, ekler) => ({ ok: true, message: ms(200, 'u1', content.trim() || YER_TUTUCU, { attachment_count: ekler.length }) })),
    fetchAttachments: vi.fn(async () => []),
    removeFiles: vi.fn(async () => {}),
    ...ek,
  }
  return k
}
async function kur(satirlar, ek = {}) {
  const kaynak = kaynakKur(satirlar, ek)
  const sohbet = mountChat(document.getElementById('main'), { source: kaynak, profile: ben })
  await bosalt()
  return { kaynak, sohbet }
}
const kutu = () => document.querySelector('.composer textarea')
async function sec(...dosyalar) {
  const girdi = document.querySelector('.composer-file-input')
  Object.defineProperty(girdi, 'files', { value: dosyalar, configurable: true })
  girdi.dispatchEvent(new Event('change'))
  await bosalt()
}
const kartlar = () => [...document.querySelectorAll('.attachment-card')]
const toastMetni = () => [...document.querySelectorAll('.toast')].map((t) => t.textContent).join(' | ')

beforeEach(() => {
  fake.profiles = [ben, ali]
  fake.uploadFile.mockReset()
  fake.uploadFile.mockImplementation(async (_y, _b, _t, { onProgress } = {}) => { onProgress?.(1) })
  fake.kullanimim.mockReset()
  fake.kullanimim.mockImplementation(async () => 0)
  fake.indir.mockClear()
  document.body.innerHTML = '<div id="main"></div>'
  // jsdom resim çözemez: tarayıcının createImageBitmap'i sahte (800×600, küçültme gerekmez)
  vi.stubGlobal('createImageBitmap', async () => ({ width: 800, height: 600, close() {} }))
})
afterEach(() => vi.unstubAllGlobals())

describe('resim küçültme ve boyutlar', () => {
  it('kucultmeBoyutu: uzun kenar 1920; küçükse null', () => {
    expect(kucultmeBoyutu(4000, 3000)).toEqual({ width: 1920, height: 1440 })
    expect(kucultmeBoyutu(1000, 4000)).toEqual({ width: 480, height: 1920 })
    expect(kucultmeBoyutu(1920, 1080)).toBe(null)
  })
  it('büyük JPEG WebP olur (0.85 kalite kucult\'e bırakılır), adı .webp; GIF ve küçük resim olduğu gibi', async () => {
    const coz = vi.fn(async () => ({ width: 4000, height: 2000, kapat: vi.fn() }))
    const webp = new Blob(['w'], { type: 'image/webp' })
    const kucult = vi.fn(async () => webp)
    const r = await resimHazirla(dosya('Tatil Foto.jpg', 'image/jpeg'), { coz, kucult })
    expect(kucult).toHaveBeenCalledWith(expect.anything(), { width: 1920, height: 960 })
    expect(r).toEqual({ blob: webp, name: 'Tatil Foto.webp', type: 'image/webp', width: 1920, height: 960 })
    const gif = dosya('a.gif', 'image/gif')
    const g = await resimHazirla(gif, { coz, kucult: vi.fn() })
    expect(g).toMatchObject({ blob: gif, name: 'a.gif', type: 'image/gif', width: 4000, height: 2000 })
    const kucuk = await resimHazirla(dosya('k.png', 'image/png'), { coz: async () => ({ width: 300, height: 200 }), kucult })
    expect(kucuk).toMatchObject({ name: 'k.png', width: 300, height: 200 })
    const pdf = dosya('a.pdf', 'application/pdf')
    expect(await resimHazirla(pdf, { coz })).toMatchObject({ blob: pdf, width: null })
    // Tarayıcı WebP üretemezse olduğu gibi gider
    const olduguGibi = await resimHazirla(dosya('b.png', 'image/png'), { coz, kucult: async () => null })
    expect(olduguGibi).toMatchObject({ name: 'b.png', type: 'image/png' })
  })
  it('önizleme 400×300 içine sığar, oran korunur', () => {
    expect(onizlemeBoyutu(800, 600)).toEqual({ width: 400, height: 300 })
    expect(onizlemeBoyutu(1000, 200)).toEqual({ width: 400, height: 80 })
    expect(onizlemeBoyutu(100, 50)).toEqual({ width: 100, height: 50 })
    expect(onizlemeBoyutu(null, 5)).toBe(null)
  })
})

describe('ekleme', () => {
  it('📎 "Dosya ekle" kutunun solunda; seçilen dosyalar kart olur (ad, boyut, ✕)', async () => {
    await kur([ms(1, 'u2')])
    const d = document.querySelector('.composer-row .composer-attach')
    expect(d.getAttribute('aria-label')).toBe('Dosya ekle')
    expect(d.nextElementSibling.nextElementSibling).toBe(kutu()) // düğme, gizli girdi, kutu
    await sec(dosya('rapor.pdf', 'application/pdf', 2048), dosya('a.png', 'image/png'))
    expect(kartlar().map((k) => k.querySelector('.attachment-card-name').textContent)).toEqual(['rapor.pdf', 'a.png'])
    expect(kartlar()[0].querySelector('.attachment-card-size').textContent).toBe('2 KB')
    expect(kartlar()[0].querySelector('.attachment-card-remove').getAttribute('aria-label')).toBe('rapor.pdf ekini kaldır')
    kartlar()[0].querySelector('.attachment-card-remove').click()
    expect(kartlar().length).toBe(1)
  })
  it('yasaklı tür, 8 MB üstü ve 4\'ten fazlası eklenmez (Türkçe uyarı)', async () => {
    await kur([])
    await sec(dosya('kur.exe', ''), dosya('x.svg', 'image/svg+xml'))
    expect(kartlar().length).toBe(0)
    expect(toastMetni()).toContain('Bu dosya türü gönderilemez.')
    await sec(dosya('buyuk.zip', 'application/zip', 9 * 1024 * 1024))
    expect(toastMetni()).toContain('Dosya çok büyük (en fazla 8 MB).')
    await sec(...[1, 2, 3, 4, 5].map((i) => dosya(`d${i}.txt`, 'text/plain')))
    expect(kartlar().length).toBe(4)
    expect(toastMetni()).toContain('Bir mesajda en fazla 4 ek olabilir.')
  })
  it('engelli DM (canSend false) ve ekleri desteklemeyen kaynakta 📎 yok', async () => {
    await kur([], { canSend: false })
    expect(document.querySelector('.composer-attach')).toBeNull()
    document.body.innerHTML = '<div id="main"></div>'
    await kur([], { sendWithAttachments: undefined })
    expect(document.querySelector('.composer-attach')).toBeNull()
  })
  it('sürükle-bırak: "Göndermek için bırak" katmanı; bırakınca kart; kapanınca dinleyici kalkar', async () => {
    const { sohbet } = await kur([])
    const alan = document.getElementById('main')
    const olay = (tur, files = []) => {
      const e = new Event(tur, { bubbles: true, cancelable: true })
      Object.defineProperty(e, 'dataTransfer', { value: { types: ['Files'], files, dropEffect: 'none' } })
      alan.dispatchEvent(e)
      return e
    }
    const katman = document.querySelector('.drop-overlay')
    expect(katman.hidden).toBe(true)
    olay('dragenter')
    expect(katman.hidden).toBe(false)
    expect(katman.textContent).toBe('Göndermek için bırak')
    expect(olay('dragover').defaultPrevented).toBe(true)
    olay('drop', [dosya('a.txt', 'text/plain')])
    await bosalt()
    expect(katman.hidden).toBe(true)
    expect(kartlar().length).toBe(1)
    sohbet.destroy()
    expect(document.querySelector('.drop-overlay')).toBeNull()
    expect(olay('dragover').defaultPrevented).toBe(false)
  })
  it('panodan resim yapıştırma kart ekler', async () => {
    await kur([])
    const e = new Event('paste', { bubbles: true, cancelable: true })
    Object.defineProperty(e, 'clipboardData', { value: { files: [dosya('image.png', 'image/png')], types: ['Files'] } })
    kutu().dispatchEvent(e)
    await bosalt()
    expect(e.defaultPrevented).toBe(true)
    expect(kartlar().length).toBe(1)
  })
})

describe('gönderme', () => {
  it('yazısız ekli gönderim: kota → yükleme (yol, depo türü) → tek RPC; kartlar temizlenir, mesaj ekleriyle çizilir', async () => {
    const { kaynak } = await kur([])
    await sec(dosya('a.png', 'image/png'), dosya('Rapor Ş.pdf', 'application/pdf', 300))
    tus(kutu(), 'Enter')
    await bosalt()
    expect(fake.kullanimim).toHaveBeenCalled()
    expect(fake.uploadFile).toHaveBeenCalledTimes(2)
    const [yol1, , tur1] = fake.uploadFile.mock.calls[0]
    const [yol2, , tur2] = fake.uploadFile.mock.calls[1]
    expect(yol1).toMatch(/^k\/c1\/u1\/[0-9a-f-]+-a\.png$/)
    expect(tur1).toBe('image/png')
    expect(yol2).toMatch(/^k\/c1\/u1\/[0-9a-f-]+-Rapor_S\.pdf$/)
    expect(tur2).toBe('application/octet-stream')
    expect(kaynak.sendWithAttachments).toHaveBeenCalledWith('', [
      { path: yol1, name: 'a.png', mime: 'image/png', width: 800, height: 600 },
      { path: yol2, name: 'Rapor Ş.pdf', mime: 'application/pdf', width: null, height: null },
    ], { replyTo: null })
    expect(kaynak.send).not.toHaveBeenCalled()
    expect(kartlar().length).toBe(0)
    const m = mesaj(200)
    expect(m.querySelector('.msg-text')).toBeNull() // "📎 dosya" yer tutucusu görünmez
    expect(m.querySelector('.att-image img').getAttribute('src')).toBe(`https://imza/${yol1}`)
    expect(m.querySelector('.att-file-name').textContent).toBe('Rapor Ş.pdf')
  })
  it('yazıyla ve yanıtla birlikte gönderilir', async () => {
    const { kaynak } = await kur([ms(1, 'u2', 'soru')])
    mesaj(1).querySelector('[data-act="yanitla"]').click()
    await sec(dosya('a.txt', 'text/plain'))
    kutu().value = 'işte'
    tus(kutu(), 'Enter')
    await bosalt()
    expect(kaynak.sendWithAttachments).toHaveBeenCalledWith('işte', expect.any(Array), { replyTo: 1 })
    expect(mesaj(200).querySelector('.msg-text').textContent).toBe('işte')
    expect(document.querySelector('.reply-bar').hidden).toBe(true)
  })
  it('yükleme sırasında ilerleme; hata olunca kart kırmızı + "Tekrar dene"; tekrar dene yüklenmeyeni yükler ve gönderir', async () => {
    const { kaynak } = await kur([])
    await sec(dosya('a.txt', 'text/plain'), dosya('b.txt', 'text/plain'))
    let birak
    fake.uploadFile.mockImplementationOnce(async (_y, _b, _t, { onProgress }) => { onProgress(0.5); await new Promise((r) => { birak = r }) })
    fake.uploadFile.mockImplementationOnce(async () => { const e = new Error('Dosya yüklenemedi. Tekrar dene.'); e.code = 'UPLOAD'; throw e })
    tus(kutu(), 'Enter')
    await bosalt()
    const ilk = kartlar()[0]
    expect(ilk.classList.contains('uploading')).toBe(true)
    expect(ilk.querySelector('progress').hidden).toBe(false)
    expect(ilk.querySelector('progress').value).toBe(50)
    expect(ilk.querySelector('.attachment-card-remove').disabled).toBe(true)
    birak()
    await bosalt()
    const ikinci = kartlar()[1]
    expect(ikinci.classList.contains('error')).toBe(true)
    expect(ikinci.querySelector('.attachment-card-retry').hidden).toBe(false)
    expect(kartlar()[0].querySelector('.attachment-card-retry').hidden).toBe(true)
    expect(kaynak.sendWithAttachments).not.toHaveBeenCalled()
    ikinci.querySelector('.attachment-card-retry').click()
    await bosalt()
    expect(fake.uploadFile).toHaveBeenCalledTimes(3) // ilk ek yeniden yüklenmedi
    expect(kaynak.sendWithAttachments).toHaveBeenCalledTimes(1)
    expect(kartlar().length).toBe(0)
  })
  it('kota dolu: yükleme başlamaz, uyarı çıkar; sunucu QUOTA dönerse metin çıkar, kartlar kalır', async () => {
    const { kaynak } = await kur([])
    await sec(dosya('a.txt', 'text/plain'))
    fake.kullanimim.mockImplementation(async () => KOTA)
    tus(kutu(), 'Enter')
    await bosalt()
    expect(fake.uploadFile).not.toHaveBeenCalled()
    expect(toastMetni()).toContain('Depolama sınırına ulaştın. Eski eklerini silerek yer açabilirsin.')
    fake.kullanimim.mockImplementation(async () => 0)
    kaynak.sendWithAttachments.mockImplementationOnce(async () => { const e = new Error('Depolama sınırına ulaştın. Eski eklerini silerek yer açabilirsin.'); e.code = 'QUOTA'; throw e })
    document.querySelectorAll('.toast').forEach((t) => t.remove())
    tus(kutu(), 'Enter')
    await bosalt()
    expect(toastMetni()).toContain('Depolama sınırına ulaştın.')
    expect(kartlar().length).toBe(1)
  })
  it('yüklenmiş ama gönderilmemiş ek ✕ ile kaldırılınca depodan silinir', async () => {
    const { kaynak } = await kur([])
    await sec(dosya('a.txt', 'text/plain'))
    kaynak.sendWithAttachments.mockImplementationOnce(async () => { throw new Error('ağ') })
    tus(kutu(), 'Enter')
    await bosalt()
    const yol = fake.uploadFile.mock.calls[0][0]
    kartlar()[0].querySelector('.attachment-card-remove').click()
    expect(kaynak.removeFiles).toHaveBeenCalledWith([yol])
  })
})

describe('görüntüleme', () => {
  it('gömülü ekler: resim önizlemesi (boyutlu), dosya kartı + İndir; yazı varsa görünür', async () => {
    await kur([
      ms(1, 'u2', YER_TUTUCU, { attachment_count: 1, attachments: [resimEk(5)] }),
      ms(2, 'u2', 'belge', { attachment_count: 1, attachments: [{ id: 6, path: 'k/c1/u2/y-a.zip', name: 'a.zip', mime: 'application/zip', size: 2048, uploader: 'u2' }] }),
      ms(3, 'u2', YER_TUTUCU), // eki yok: yer tutucu düz yazı (ekler gelmediyse boş görünmesin)
    ])
    const b = mesaj(1).querySelector('.att-image')
    expect(b.style.width).toBe('400px')
    expect(b.style.height).toBe('300px')
    expect(b.getAttribute('aria-label')).toBe('r5.png resmini büyüt')
    expect(mesaj(1).querySelector('.msg-text')).toBeNull()
    expect(mesaj(2).querySelector('.msg-text').textContent).toBe('belge')
    expect(mesaj(2).querySelector('.att-file-icon').textContent).toBe('🗜️')
    expect(mesaj(2).querySelector('.att-file-size').textContent).toBe('2 KB')
    mesaj(2).querySelector('.att-file-download').click()
    expect(fake.indir).toHaveBeenCalledWith(expect.objectContaining({ path: 'k/c1/u2/y-a.zip', name: 'a.zip' }))
    expect(mesaj(3).querySelector('.msg-text').textContent).toBe(YER_TUTUCU)
  })
  it('canlı ekli mesaj: ek sayısı > 0 ise ekler tek sorguyla gelir', async () => {
    const { kaynak } = await kur([], {
      fetchAttachments: vi.fn(async (ids) => ids.map((id) => ({ ...resimEk(9), message_id: id }))),
    })
    kaynak.olaylar.onInsert(ms(7, 'u2', YER_TUTUCU, { attachment_count: 1 }))
    kaynak.olaylar.onInsert(ms(8, 'u2', 'düz'))
    await bosalt()
    expect(kaynak.fetchAttachments).toHaveBeenCalledTimes(1)
    expect(kaynak.fetchAttachments).toHaveBeenCalledWith([7])
    expect(mesaj(7).querySelector('.att-image')).not.toBeNull()
    expect(mesaj(7).querySelector('.msg-text')).toBeNull()
  })
  it('görüntüleyici: dialog, odak ✕\'te; ← → aynı mesajın resimleri; İndir; Esc kapatır, odak resme döner', async () => {
    await kur([ms(1, 'u2', 'üç resim', { attachment_count: 3, attachments: [resimEk(1, 'a.png'), { id: 2, path: 'p/z', name: 'b.zip', mime: 'application/zip', size: 1 }, resimEk(3, 'c.png')] })])
    const resimler = mesaj(1).querySelectorAll('.att-image')
    expect(resimler.length).toBe(2)
    resimler[1].focus()
    resimler[1].click()
    const v = document.querySelector('.att-viewer')
    expect(v.getAttribute('role')).toBe('dialog')
    expect(v.getAttribute('aria-modal')).toBe('true')
    expect(document.activeElement).toBe(v.querySelector('.att-viewer-close'))
    expect(v.querySelector('.att-viewer-title').textContent).toBe('c.png (2 / 2)')
    tus(v, 'ArrowRight')
    expect(v.querySelector('.att-viewer-title').textContent).toBe('a.png (1 / 2)')
    expect(v.querySelector('.att-viewer-img').getAttribute('src')).toBe('https://imza/k/c1/u2/x-a.png')
    tus(v, 'ArrowLeft')
    expect(v.querySelector('.att-viewer-title').textContent).toBe('c.png (2 / 2)')
    v.querySelector('.att-viewer-download').click()
    expect(fake.indir).toHaveBeenCalledWith(expect.objectContaining({ name: 'c.png' }))
    tus(v, 'Escape')
    expect(document.querySelector('.att-viewer')).toBeNull()
    expect(document.activeElement).toBe(mesaj(1).querySelectorAll('.att-image')[1])
  })
  it('tek resimde gezinme düğmesi yok; ✕ kapatır', () => {
    const k = goruntuleyiciAc([resimEk(1)], 0)
    expect(document.querySelector('.att-viewer-nav')).toBeNull()
    document.querySelector('.att-viewer-close').click()
    expect(document.querySelector('.att-viewer')).toBeNull()
    expect(k.sira()).toBe(0)
  })
  it('ekli mesaj silinince bütün ekleri depodan silinir (yollar silmeden önce alınır; sahip moderasyonu dahil)', async () => {
    const { kaynak } = await kur([ms(1, 'u2', 'x', { attachment_count: 2, attachments: [resimEk(1, 'a.png', { path: 'k/c1/u2/a' }), resimEk(2, 'b.png', { path: 'k/c1/u2/b' })] })],
      { canDelete: () => true }) // sunucu sahibi başkasının mesajını siler
    let sirada = null
    kaynak.remove.mockImplementation(async () => { sirada = kaynak.removeFiles.mock.calls.length })
    mesaj(1).querySelector('[data-act="sil"]').dispatchEvent(new MouseEvent('click', { shiftKey: true, bubbles: true }))
    await bosalt()
    expect(kaynak.remove).toHaveBeenCalledWith(1)
    expect(sirada).toBe(0) // dosyalar mesaj silindikten SONRA (ek satırı gidince sahibe izin var)
    expect(kaynak.removeFiles).toHaveBeenCalledWith(['k/c1/u2/a', 'k/c1/u2/b'])
    expect(mesaj(1)).toBeNull()
  })
  it('yazısız ekli mesajı düzenlerken kutu boş açılır', async () => {
    await kur([ms(1, 'u1', YER_TUTUCU, { attachment_count: 1, attachments: [resimEk(1, 'a.png', { uploader: 'u1' })] })])
    mesaj(1).querySelector('[data-act="duzenle"]').click()
    expect(document.querySelector('.msg-edit-input').value).toBe('')
  })
  it('yazısız ekli mesajı değiştirmeden kaydetmek "değişmedi" sayılır (uyarı yok, istek yok)', async () => {
    const { kaynak } = await kur([ms(1, 'u1', YER_TUTUCU, { attachment_count: 1, attachments: [resimEk(1, 'a.png', { uploader: 'u1' })] })])
    mesaj(1).querySelector('[data-act="duzenle"]').click()
    tus(document.querySelector('.msg-edit-input'), 'Enter')
    await bosalt()
    expect(kaynak.edit).not.toHaveBeenCalled()
    expect(document.querySelector('.msg-edit-input')).toBeNull()
  })
})

describe('gönderim yarışları (inceleme düzeltmeleri)', () => {
  it('Ö-2: RPC sürerken sohbet kapanırsa yüklenmiş dosyalar silinmez; RPC başarılıysa dokunulmaz', async () => {
    let bitir
    const { kaynak, sohbet } = await kur([], {
      sendWithAttachments: vi.fn(() => new Promise((r) => { bitir = r })),
    })
    await sec(dosya('a.txt', 'text/plain'))
    tus(kutu(), 'Enter')
    await bosalt()
    expect(kaynak.sendWithAttachments).toHaveBeenCalled()
    sohbet.destroy()
    expect(kaynak.removeFiles).not.toHaveBeenCalled()
    bitir({ ok: true, message: ms(200, 'u1', YER_TUTUCU, { attachment_count: 1 }) })
    await bosalt()
    expect(kaynak.removeFiles).not.toHaveBeenCalled()
  })
  it('Ö-2: RPC sürerken sohbet kapandı ve RPC düştü: dosyalar silinir (yetim kalmaz)', async () => {
    let dusur
    const { kaynak, sohbet } = await kur([], {
      sendWithAttachments: vi.fn(() => new Promise((_, h) => { dusur = h })),
    })
    await sec(dosya('a.txt', 'text/plain'))
    tus(kutu(), 'Enter')
    await bosalt()
    const yol = fake.uploadFile.mock.calls[0][0]
    sohbet.destroy()
    expect(kaynak.removeFiles).not.toHaveBeenCalled()
    dusur(new Error('ağ'))
    await bosalt()
    expect(kaynak.removeFiles).toHaveBeenCalledWith([yol])
  })
  it('Ö-2: gönderilmemiş (gönderimde olmayan) yüklenmiş ek kapanışta silinir', async () => {
    const { kaynak, sohbet } = await kur([])
    await sec(dosya('a.txt', 'text/plain'))
    kaynak.sendWithAttachments.mockImplementationOnce(async () => { throw new Error('ağ') })
    tus(kutu(), 'Enter')
    await bosalt()
    const yol = fake.uploadFile.mock.calls[0][0]
    sohbet.destroy()
    expect(kaynak.removeFiles).toHaveBeenCalledWith([yol])
  })
  it('gönderim sürerken eklenen dosya RPC\'ye yolsuz gitmez; kutuda kalır', async () => {
    let birak
    const { kaynak } = await kur([])
    await sec(dosya('a.txt', 'text/plain'))
    fake.uploadFile.mockImplementationOnce(async () => { await new Promise((r) => { birak = r }) })
    tus(kutu(), 'Enter')
    await bosalt()
    await sec(dosya('b.txt', 'text/plain')) // yükleme sürerken
    birak()
    await bosalt()
    const gonderilen = kaynak.sendWithAttachments.mock.calls[0][1]
    expect(gonderilen.map((e) => e.name)).toEqual(['a.txt'])
    expect(gonderilen.every((e) => e.path)).toBe(true)
    expect(kartlar().map((k) => k.querySelector('.attachment-card-name').textContent)).toEqual(['b.txt'])
  })
  it('resim küçültülürken Enter: hazırlık beklenir, mesaj ekiyle gider', async () => {
    let coz
    vi.stubGlobal('createImageBitmap', () => new Promise((r) => { coz = () => r({ width: 10, height: 10, close() {} }) }))
    const { kaynak } = await kur([])
    const girdi = document.querySelector('.composer-file-input')
    Object.defineProperty(girdi, 'files', { value: [dosya('a.png', 'image/png')], configurable: true })
    girdi.dispatchEvent(new Event('change'))
    await bosalt()
    kutu().value = 'bak'
    tus(kutu(), 'Enter')
    await bosalt()
    expect(kaynak.send).not.toHaveBeenCalled()
    expect(kaynak.sendWithAttachments).not.toHaveBeenCalled()
    coz()
    await bosalt()
    expect(kaynak.send).not.toHaveBeenCalled()
    expect(kaynak.sendWithAttachments).toHaveBeenCalledWith('bak', [expect.objectContaining({ name: 'a.png', width: 10, height: 10 })], { replyTo: null })
  })
  it('yükleme kota yüzünden reddedilirse kartta kota metni çıkar', async () => {
    await kur([])
    await sec(dosya('a.txt', 'text/plain'))
    fake.uploadFile.mockImplementationOnce(async () => { const e = new Error('Depolama sınırına ulaştın. Eski eklerini silerek yer açabilirsin.'); e.code = 'QUOTA'; throw e })
    tus(kutu(), 'Enter')
    await bosalt()
    expect(kartlar()[0].classList.contains('error')).toBe(true)
    expect(kartlar()[0].querySelector('.attachment-card-error').textContent).toContain('Depolama sınırına ulaştın.')
  })
})

describe('v0.7.0 küçük düzeltmeleri', () => {
  it('K-1: yanıtlanan mesaj silinmişken gönderim reddedilirse "Yanıtladığın mesaj silinmiş."; şerit kapanır, yazı kalır, tekrar gönderilebilir', async () => {
    const { kaynak } = await kur([ms(1, 'u2', 'soru')], {
      send: vi.fn(async (content, opts) => {
        if (opts?.replyTo) throw new Error('Bu kişiye mesaj gönderemezsin.')
        return { ok: true, message: ms(100, 'u1', content) }
      }),
      fetchByIds: vi.fn(async () => [{ id: 1, author_id: 'u2', content: '', deleted_at: '2026-11-14T10:00:00Z' }]),
    })
    mesaj(1).querySelector('[data-act="yanitla"]').click()
    kutu().value = 'cevap'
    tus(kutu(), 'Enter')
    await bosalt()
    expect(kaynak.fetchByIds).toHaveBeenCalledWith([1])
    expect(toastMetni()).toContain('Yanıtladığın mesaj silinmiş.')
    expect(toastMetni()).not.toContain('Bu kişiye mesaj gönderemezsin.')
    expect(document.querySelector('.reply-bar').hidden).toBe(true)
    expect(kutu().value).toBe('cevap')
    tus(kutu(), 'Enter')
    await bosalt()
    expect(kaynak.send).toHaveBeenLastCalledWith('cevap')
    expect(mesaj(100)).not.toBeNull()
  })
  it('K-1: hedef duruyorsa asıl hata (engel) gösterilir', async () => {
    await kur([ms(1, 'u2', 'soru')], {
      send: vi.fn(async () => { throw new Error('Bu kişiye mesaj gönderemezsin.') }),
      fetchByIds: vi.fn(async () => [{ id: 1, author_id: 'u2', content: 'soru', deleted_at: null }]),
    })
    mesaj(1).querySelector('[data-act="yanitla"]').click()
    kutu().value = 'cevap'
    tus(kutu(), 'Enter')
    await bosalt()
    expect(toastMetni()).toContain('Bu kişiye mesaj gönderemezsin.')
    expect(document.querySelector('.reply-bar').hidden).toBe(false)
  })
  it('K-1: ekli gönderimde REPLY_GONE da aynı metni verir', async () => {
    const { kaynak } = await kur([ms(1, 'u2', 'soru')])
    kaynak.sendWithAttachments.mockImplementationOnce(async () => { const e = new Error('Yanıtladığın mesaj silinmiş.'); e.code = 'REPLY_GONE'; throw e })
    mesaj(1).querySelector('[data-act="yanitla"]').click()
    await sec(dosya('a.txt', 'text/plain'))
    tus(kutu(), 'Enter')
    await bosalt()
    expect(toastMetni()).toContain('Yanıtladığın mesaj silinmiş.')
    expect(document.querySelector('.reply-bar').hidden).toBe(true)
    expect(kartlar().length).toBe(1)
  })
  it('K-3: sohbet kapanınca açık tepki seçici de kapanır ve RPC atılmaz', async () => {
    const { kaynak, sohbet } = await kur([ms(1, 'u2')])
    mesaj(1).querySelector('[data-act="tepki"]').click()
    const secici = document.querySelector('.reaction-picker')
    expect(secici).not.toBeNull()
    const emoji = secici.querySelector('.reaction-choice')
    sohbet.destroy()
    expect(document.querySelector('.reaction-picker')).toBeNull()
    emoji.click()
    await bosalt()
    expect(kaynak.react).not.toHaveBeenCalled()
  })
  it('K-4: süren yavaş yükleme bitmeden "Mesaj bulunamadı" denmez; bitince mesaja gidilir', async () => {
    const tumu = Array.from({ length: 60 }, (_, i) => ms(i + 1, 'u2'))
    let birak = null
    const { kaynak } = await kur(tumu.concat([ms(70, 'u1', 'yanıt', { reply_to: 3 })]), {
      fetchByIds: vi.fn(async (ids) => tumu.filter((m) => ids.includes(m.id))),
    })
    // Sonraki eski sayfa isteği yavaş (elle bırakılır)
    const asil = kaynak.fetch.getMockImplementation()
    kaynak.fetch.mockImplementationOnce(async (...a) => { await new Promise((r) => { birak = r }); return asil(...a) })
    const liste = document.querySelector('.message-list')
    liste.scrollTop = 0
    liste.dispatchEvent(new Event('scroll'))
    await bosalt()
    expect(birak).toBeTypeOf('function')
    mesaj(70).querySelector('.msg-reply').click()
    await new Promise((r) => setTimeout(r, 700)) // eski kodda 10 × 50 ms sonra pes ediliyordu
    expect(toastMetni()).not.toContain('Mesaj bulunamadı')
    birak()
    await bosalt()
    expect(toastMetni()).not.toContain('Mesaj bulunamadı')
    expect(mesaj(3).classList.contains('flash')).toBe(true)
  })
  it('K-6: sabit listesinde sabitlenme tarihi gösterilir', async () => {
    sabitListesiAc({
      yukle: async () => [{ ...ms(1, 'u2', 'eski'), created_at: '2020-01-05T10:00:00Z', pinned_at: '2026-11-14T09:30:00Z' }],
      adBul: () => 'ali', yetkili: () => false, kaldir: async () => {}, git: () => {},
    })
    await bosalt()
    const tarih = document.querySelector('.pin-item-date').textContent
    expect(tarih).toContain('2026')
    expect(tarih).not.toContain('2020')
  })
})
