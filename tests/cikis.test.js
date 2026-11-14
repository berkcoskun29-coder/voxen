// Masaüstünde düzgün çıkış (src/cikis.js, v0.13.0 düzeltme turu 1, Ö2)
import { describe, it, expect, vi } from 'vitest'
import { createQuitHandler } from '../src/cikis.js'

describe('createQuitHandler', () => {
  it('önce temizlik (sesli kanaldan ayrılma) biter, sonra quit_now', async () => {
    const sira = []
    const h = createQuitHandler({
      temizle: async () => { await Promise.resolve(); sira.push('temizle') },
      cik: async () => { sira.push('cik') },
    })
    await h()
    expect(sira).toEqual(['temizle', 'cik'])
  })

  it('temizlik takılırsa süre dolunca yine çıkılır; hata da çıkışı engellemez; bir kez çalışır', async () => {
    vi.useFakeTimers()
    try {
      const cik = vi.fn()
      const h = createQuitHandler({ temizle: () => new Promise(() => {}), cik, sureMs: 1500 })
      const p = h()
      await vi.advanceTimersByTimeAsync(1500)
      await p
      expect(cik).toHaveBeenCalledTimes(1)
      await h()
      expect(cik).toHaveBeenCalledTimes(1)
      const cik2 = vi.fn()
      await createQuitHandler({ temizle: () => { throw new Error('x') }, cik: cik2 })()
      expect(cik2).toHaveBeenCalledTimes(1)
    } finally { vi.useRealTimers() }
  })
})
