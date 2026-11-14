// @vitest-environment jsdom
// Dosya/resim ekleri veri katmanı (010): kurallar, yükleme (XHR, ilerleme), imzalı adres önbelleği,
// ekli gönderme RPC'leri ve hata metinleri, kaynak nesneleri, yetim temizliği. Ağ yok: Supabase sahte.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const fake = vi.hoisted(() => ({}))
vi.mock('../src/config.js', () => ({ SUPABASE_URL: 'https://ornek.supabase.co', SUPABASE_ANON_KEY: 'anon' }))
vi.mock('../src/lib/supabase.js', () => {
  fake.sorgular = []
  fake.sonuc = () => ({ data: [], error: null })
  fake.from = (tablo) => {
    const d = { tablo, select: null, in: null, order: null }
    fake.sorgular.push(d)
    const z = {
      select: (s) => { d.select = s; return z },
      in: (k, v) => { d.in = [k, v]; return z },
      order: (k, o) => { d.order = [k, o]; return z },
      then: (res) => Promise.resolve(fake.sonuc(d)).then(res),
    }
    return z
  }
  fake.rpc = vi.fn(async () => ({ data: null, error: null }))
  fake.storage = {
    createSignedUrls: vi.fn(async (yollar) => ({ data: yollar.map((p) => ({ path: p, signedUrl: `https://imza/${p}`, error: null })), error: null })),
    createSignedUrl: vi.fn(async (p, _s, o) => ({ data: { signedUrl: `https://indir/${p}?d=${o?.download}` }, error: null })),
    remove: vi.fn(async () => ({ data: [], error: null })),
    upload: vi.fn(async () => ({ data: {}, error: null })),
  }
  return {
    supabase: {
      from: (...a) => fake.from(...a),
      rpc: (...a) => fake.rpc(...a),
      storage: { from: () => fake.storage },
      auth: { getSession: async () => ({ data: { session: { access_token: 'jeton' } } }) },
      channel: () => ({ on() { return this }, subscribe() { return this } }),
      removeChannel: async () => {},
    },
  }
})

import {
  uzanti, turYasakMi, gizliKarakterVar, guvenliAd, ekYolu, boyutMetni, ekDenetle, depoTuru, resimMi, dosyaSimgesi,
  YER_TUTUCU, EK_METINLERI, DOSYA_SINIRI, KOTA,
} from '../src/data/ekKurallari.js'
import {
  uploadFile, adresAl, hazirAdres, indirmeAdresi, resetEkAdresleri, fetchAttachments,
  sendMessageWithAttachments, kullanimim, removeFiles, yetimleriTemizle,
} from '../src/data/attachments.js'
import { channelSource } from '../src/data/messages.js'
import { dmSource } from '../src/data/dms.js'
import { MESAJ_SECIMI, DM_MESAJ_SECIMI, EK_SECIMI } from '../src/data/sorgular.js'

beforeEach(() => {
  fake.sorgular = []
  fake.sonuc = () => ({ data: [], error: null })
  fake.rpc.mockReset()
  fake.rpc.mockImplementation(async () => ({ data: null, error: null }))
  for (const f of Object.values(fake.storage)) f.mockClear()
  resetEkAdresleri()
  try { localStorage.clear() } catch { /* yok */ }
})

describe('kurallar', () => {
  it('uzantı ve yasaklı türler (uzantı ya da MIME)', () => {
    expect(uzanti('Resim.PNG')).toBe('png')
    expect(uzanti('arsiv.tar.gz')).toBe('gz')
    expect(uzanti('README')).toBe('')
    for (const ad of ['a.exe', 'b.MSI', 'c.bat', 'd.cmd', 'e.ps1', 'f.sh', 'g.js', 'h.vbs', 'i.scr', 'j.jar', 'k.html', 'l.htm', 'm.svg']) {
      expect(turYasakMi(ad, ''), ad).toBe(true)
    }
    expect(turYasakMi('rapor.txt', 'text/html; charset=utf-8')).toBe(true)
    expect(turYasakMi('logo.png', 'image/svg+xml')).toBe(true)
    expect(turYasakMi('foto.jpg', 'image/jpeg')).toBe(false)
    expect(turYasakMi('notlar.txt', 'text/plain')).toBe(false)
  })
  it('sondaki nokta/boşluk uzantıyı gizleyemez; gizli karakterli (RLO, sıfır genişlik) ad yasaklı', () => {
    for (const ad of ['virus.exe.', 'a.exe..', 'a.exe. .', 'a.EXE \t', 'kurulum.bat.']) {
      expect(uzanti(ad), ad).toMatch(/^(exe|bat)$/)
      expect(turYasakMi(ad, 'application/octet-stream'), ad).toBe(true)
    }
    expect(turYasakMi('resim\u202Egnp.exe', '')).toBe(true) // RLO: ekranda başka uzantı gibi görünür
    expect(turYasakMi('fo\u200Bto.png', 'image/png')).toBe(true)
    expect(turYasakMi('satir\nsonu.txt', '')).toBe(true)
    expect(gizliKarakterVar('Çalışma Şöleni.pdf')).toBe(false)
    expect(ekDenetle('x\u202Etxt.exe', '', 1)).toBe('Bu dosya türü gönderilemez.')
  })
  it('güvenli ad: Türkçe harf ve boşluk sadeleşir, uzantı korunur, en çok 80 karakter', () => {
    expect(guvenliAd('Çalışma Şöleni ğü.pdf')).toBe('Calisma_Soleni_gu.pdf')
    expect(guvenliAd('../../gizli')).toBe('gizli')
    expect(guvenliAd('')).toBe('dosya')
    const uzun = guvenliAd('a'.repeat(200) + '.jpeg')
    expect(uzun.length).toBe(80)
    expect(uzun.endsWith('.jpeg')).toBe(true)
    expect(ekYolu('k/c1', 'u1', 'x-y', 'ö z.png')).toBe('k/c1/u1/x-y-o_z.png')
  })
  it('boyut metni, istemci denetimi (önce tür, sonra 8 MB), depo türü, simge', () => {
    expect(boyutMetni(512)).toBe('512 B')
    expect(boyutMetni(12 * 1024)).toBe('12 KB')
    expect(boyutMetni(1.25 * 1024 * 1024)).toMatch(/^1,[23] MB$/)
    expect(ekDenetle('a.exe', '', 10)).toBe('Bu dosya türü gönderilemez.')
    expect(ekDenetle('a.zip', '', DOSYA_SINIRI + 1)).toBe('Dosya çok büyük (en fazla 8 MB).')
    expect(ekDenetle('a.zip', '', DOSYA_SINIRI)).toBe(null)
    expect(depoTuru('image/png')).toBe('image/png')
    expect(depoTuru('application/pdf')).toBe('application/octet-stream')
    expect(depoTuru('image/heic')).toBe('application/octet-stream')
    expect(resimMi('image/gif')).toBe(true)
    expect(dosyaSimgesi('audio/mpeg', 'a.mp3')).toBe('🎵')
    expect(dosyaSimgesi('', 'a.zip')).toBe('🗜️')
    expect(dosyaSimgesi('application/pdf', 'a.pdf')).toBe('📄')
    expect(YER_TUTUCU).toBe('📎 dosya')
    expect(EK_METINLERI.QUOTA).toBe('Depolama sınırına ulaştın. Eski eklerini silerek yer açabilirsin.')
  })
})

describe('sorgu metinleri', () => {
  it('mesaj sorgusu ekleri gömer (iki tür de); kaynaklar aynı metni kullanır', () => {
    expect(EK_SECIMI).toBe('id, path, name, mime, size, width, height, uploader')
    expect(MESAJ_SECIMI.endsWith(`attachments(${EK_SECIMI})`)).toBe(true)
    expect(DM_MESAJ_SECIMI.endsWith(`attachments(${EK_SECIMI})`)).toBe(true)
  })
})

describe('yükleme', () => {
  let son
  class SahteXHR {
    constructor() { son = this; this.basliklar = {}; this.upload = {} }
    open(y, a) { this.yontem = y; this.adres = a }
    setRequestHeader(k, v) { this.basliklar[k] = v }
    send(g) {
      this.govde = g
      queueMicrotask(() => {
        this.upload.onprogress?.({ lengthComputable: true, loaded: 5, total: 10 })
        this.status = SahteXHR.durum
        this.responseText = SahteXHR.yanit
        this.onload()
      })
    }
  }
  beforeEach(() => { SahteXHR.durum = 200; SahteXHR.yanit = '{}'; vi.stubGlobal('XMLHttpRequest', SahteXHR) })
  afterEach(() => vi.unstubAllGlobals())

  it('Storage REST adresine POST: oturum anahtarı, tür, üzerine yazma yok; ilerleme bildirilir', async () => {
    const ilerleme = []
    const blob = new Blob(['x'])
    await uploadFile('k/c1/u1/id-a.png', blob, 'image/png', { onProgress: (p) => ilerleme.push(p) })
    expect(son.yontem).toBe('POST')
    expect(son.adres).toBe('https://ornek.supabase.co/storage/v1/object/ekler/k/c1/u1/id-a.png')
    expect(son.basliklar).toMatchObject({ Authorization: 'Bearer jeton', apikey: 'anon', 'Content-Type': 'image/png', 'x-upsert': 'false' })
    expect(son.govde).toBe(blob)
    expect(ilerleme).toEqual([0.5, 1])
  })
  it('politika reddi (403) ve kota dolu -> QUOTA metni; kota boşsa UPLOAD kalır', async () => {
    SahteXHR.durum = 403; SahteXHR.yanit = JSON.stringify({ message: 'new row violates row-level security policy' })
    fake.rpc.mockImplementation(async () => ({ data: KOTA, error: null }))
    await expect(uploadFile('y', new Blob([]), 'x')).rejects.toMatchObject({ code: 'QUOTA', message: EK_METINLERI.QUOTA })
    expect(fake.rpc).toHaveBeenCalledWith('ek_kullanimim')
    fake.rpc.mockImplementation(async () => ({ data: 10, error: null }))
    await expect(uploadFile('y', new Blob([]), 'x')).rejects.toMatchObject({ code: 'UPLOAD' })
  })
  it('v0.12 (v08 K-4): kota boşken politika reddi: yasaklı türde "Bu dosya türü gönderilemez.", değilse izin metni', async () => {
    SahteXHR.durum = 403; SahteXHR.yanit = JSON.stringify({ message: 'new row violates row-level security policy' })
    fake.rpc.mockImplementation(async () => ({ data: 10, error: null }))
    await expect(uploadFile('k/c1/u1/id-kur.exe', new Blob([]), 'application/octet-stream'))
      .rejects.toMatchObject({ code: 'BLOCKED_TYPE', message: 'Bu dosya türü gönderilemez.' })
    await expect(uploadFile('k/c1/u1/id-a.txt', new Blob([]), 'application/octet-stream'))
      .rejects.toMatchObject({ code: 'UPLOAD', message: 'Dosya buraya yüklenemedi. Buraya dosya gönderme iznin olmayabilir.' })
  })
  it('hatalar Türkçe: 413 -> çok büyük; mime -> tür; diğer -> UPLOAD', async () => {
    SahteXHR.durum = 413
    await expect(uploadFile('y', new Blob([]), 'x')).rejects.toMatchObject({ code: 'TOO_LARGE', message: 'Dosya çok büyük (en fazla 8 MB).' })
    SahteXHR.durum = 400; SahteXHR.yanit = JSON.stringify({ message: 'mime type text/html is not supported' })
    await expect(uploadFile('y', new Blob([]), 'x')).rejects.toMatchObject({ code: 'BLOCKED_TYPE' })
    SahteXHR.durum = 403; SahteXHR.yanit = JSON.stringify({ message: 'new row violates row-level security policy' })
    await expect(uploadFile('y', new Blob([]), 'x')).rejects.toMatchObject({ code: 'UPLOAD' })
  })
})

describe('imzalı adresler', () => {
  it('aynı turda istenenler tek createSignedUrls çağrısında (1 saat); sonra önbellekten', async () => {
    const [a, b] = await Promise.all([adresAl('k/1/u/a'), adresAl('k/1/u/b'), adresAl('k/1/u/a')])
    expect(a).toBe('https://imza/k/1/u/a')
    expect(b).toBe('https://imza/k/1/u/b')
    expect(fake.storage.createSignedUrls).toHaveBeenCalledTimes(1)
    expect(fake.storage.createSignedUrls).toHaveBeenCalledWith(['k/1/u/a', 'k/1/u/b'], 3600)
    expect(hazirAdres('k/1/u/a')).toBe('https://imza/k/1/u/a')
    await adresAl('k/1/u/a')
    expect(fake.storage.createSignedUrls).toHaveBeenCalledTimes(1)
  })
  it('süresine 1 dakikadan az kalınca yenisi alınır', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      await adresAl('p')
      vi.setSystemTime(Date.now() + 3600 * 1000 - 30 * 1000)
      expect(hazirAdres('p')).toBe(null)
      await adresAl('p')
      expect(fake.storage.createSignedUrls).toHaveBeenCalledTimes(2)
    } finally { vi.useRealTimers() }
  })
  it('indirme adresi dosya adıyla (Content-Disposition), önbellekli', async () => {
    expect(await indirmeAdresi('p', 'Rapor.pdf')).toBe('https://indir/p?d=Rapor.pdf')
    await indirmeAdresi('p', 'Rapor.pdf')
    expect(fake.storage.createSignedUrl).toHaveBeenCalledTimes(1)
    expect(fake.storage.createSignedUrl).toHaveBeenCalledWith('p', 3600, { download: 'Rapor.pdf' })
  })
})

describe('ekli gönderme ve ekleri getirme', () => {
  const ekler = [{ path: 'k/c1/u1/x-a.png', name: 'a.png', mime: 'image/png', width: 10, height: 5 }]
  it('kanal RPC: cid, metin (kırpılmış), ekler, yanit', async () => {
    fake.rpc.mockImplementation(async () => ({ data: { id: 9 }, error: null }))
    const r = await sendMessageWithAttachments('c1', '  selam ', ekler, { replyTo: 3 })
    expect(fake.rpc).toHaveBeenCalledWith('send_message_with_attachments', { cid: 'c1', metin: 'selam', ekler, yanit: 3 })
    expect(r).toEqual({ ok: true, message: { id: 9 } })
    expect(await sendMessageWithAttachments('c1', 'x'.repeat(2001), ekler)).toMatchObject({ ok: false })
  })
  it('hata kodları Türkçe; kanalda NOT_ALLOWED genel metin', async () => {
    for (const [kod, metin] of [['QUOTA', EK_METINLERI.QUOTA], ['REPLY_GONE', 'Yanıtladığın mesaj silinmiş.'], ['TOO_MANY', 'Bir mesajda en fazla 4 ek olabilir.'], ['BLOCKED_TYPE', 'Bu dosya türü gönderilemez.'], ['TOO_LARGE', 'Dosya çok büyük (en fazla 8 MB).'], ['NOT_ALLOWED', 'Mesaj gönderilemedi. Tekrar dene.']]) {
      fake.rpc.mockImplementation(async () => ({ data: null, error: { message: kod } }))
      await expect(sendMessageWithAttachments('c1', '', ekler)).rejects.toMatchObject({ code: kod, message: metin })
    }
  })
  it('DM kaynağı: send_dm_with_attachments; engel kodları "Bu kişiye mesaj gönderemezsin." (ikisi aynı)', async () => {
    const k = dmSource({ id: 't1', other: { username: 'ali' } }, { id: 'u1' })
    expect(k.ekKlasoru).toBe('d/t1')
    fake.rpc.mockImplementation(async () => ({ data: { id: 1 }, error: null }))
    await k.sendWithAttachments('', ekler, { replyTo: null })
    expect(fake.rpc).toHaveBeenLastCalledWith('send_dm_with_attachments', { tid: 't1', metin: '', ekler, yanit: null })
    for (const kod of ['BLOCKED_DM', 'NOT_ALLOWED']) {
      fake.rpc.mockImplementation(async () => ({ data: null, error: { message: kod } }))
      await expect(k.sendWithAttachments('', ekler)).rejects.toThrow('Bu kişiye mesaj gönderemezsin.')
    }
  })
  it('kanal kaynağı: klasör k/<kanal>, ekleri message_id ile getirir; DM dm_message_id ile', async () => {
    const k = channelSource({ id: 'c1', name: 'genel' }, { selfId: 'u1' })
    expect(k.ekKlasoru).toBe('k/c1')
    await k.fetchAttachments([4, 5])
    expect(fake.sorgular[0]).toMatchObject({ tablo: 'attachments', in: ['message_id', [4, 5]], order: ['id', { ascending: true }] })
    expect(fake.sorgular[0].select).toBe(`${EK_SECIMI}, message_id, dm_message_id`)
    await fetchAttachments('dm', [7])
    expect(fake.sorgular[1].in).toEqual(['dm_message_id', [7]])
    await fetchAttachments('dm', [])
    expect(fake.sorgular.length).toBe(2)
  })
})

describe('kota, silme, yetim temizliği', () => {
  it('kullanimim: sayı; hata ya da bilinmezse null', async () => {
    fake.rpc.mockImplementation(async () => ({ data: 1234, error: null }))
    expect(await kullanimim()).toBe(1234)
    expect(fake.rpc).toHaveBeenLastCalledWith('ek_kullanimim')
    fake.rpc.mockImplementation(async () => ({ data: null, error: { message: 'x' } }))
    expect(await kullanimim()).toBe(null)
  })
  it('removeFiles: Storage API remove; boşsa çağrı yok; hata yutulur', async () => {
    await removeFiles([])
    expect(fake.storage.remove).not.toHaveBeenCalled()
    await removeFiles(['a', null, 'b'])
    expect(fake.storage.remove).toHaveBeenCalledWith(['a', 'b'])
    fake.storage.remove.mockImplementationOnce(async () => { throw new Error('ağ') })
    await expect(removeFiles(['a'])).resolves.toBeUndefined()
  })
  it('yetimleriTemizle: yetim_eklerim yollarını Storage API ile siler; günde bir kez', async () => {
    fake.rpc.mockImplementation(async () => ({ data: ['k/1/u/a', 'k/1/u/b'], error: null }))
    expect(await yetimleriTemizle({ simdi: 1e12 })).toBe(2)
    expect(fake.rpc).toHaveBeenCalledWith('yetim_eklerim')
    expect(fake.storage.remove).toHaveBeenCalledWith(['k/1/u/a', 'k/1/u/b'])
    expect(await yetimleriTemizle({ simdi: 1e12 + 1000 })).toBe(0)
    expect(fake.rpc).toHaveBeenCalledTimes(1)
    expect(await yetimleriTemizle({ simdi: 1e12 + 25 * 3600 * 1000 })).toBe(2)
  })
})
