// @vitest-environment jsdom
// "Şifremi unuttum" (U11): sıfırlama e-postası, yeni şifre kaydı, dönüş linkinin yakalanması.
// Supabase istemcisi sahte nesneyle değiştirilir, ağ kullanılmaz.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const fake = vi.hoisted(() => ({}))
vi.mock('../src/lib/supabase.js', () => {
  fake.reset = vi.fn(async () => ({ data: {}, error: null }))
  fake.updateUser = vi.fn(async () => ({ data: { user: { id: 'u1' } }, error: null }))
  return {
    supabase: {
      auth: {
        resetPasswordForEmail: (...a) => fake.reset(...a),
        updateUser: (...a) => fake.updateUser(...a),
      },
    },
  }
})

import { requestPasswordReset, updatePassword } from '../src/auth/auth.js'
import {
  resetRedirectUrl, captureRecoveryFromUrl, isRecoveryPending, markRecoveryPending,
  clearRecoveryPending, takeRecoveryLinkError,
} from '../src/auth/recovery.js'

const COK_DENEME = 'Çok fazla deneme yapıldı. Birkaç dakika bekleyip tekrar dene.'

beforeEach(() => {
  fake.reset.mockReset()
  fake.reset.mockImplementation(async () => ({ data: {}, error: null }))
  fake.updateUser.mockReset()
  fake.updateUser.mockImplementation(async () => ({ data: { user: { id: 'u1' } }, error: null }))
  localStorage.clear()
  history.replaceState(null, '', '/')
})

describe('resetRedirectUrl', () => {
  it('yayında PUBLIC_URL + / (hash yok, sondaki fazla / atılır)', () => {
    expect(resetRedirectUrl({ dev: false, publicUrl: 'https://voxen-sohbet.pages.dev/', origin: 'http://localhost:5173' }))
      .toBe('https://voxen-sohbet.pages.dev/')
  })
  it('geliştirmede (dev) sayfanın kendi adresi', () => {
    expect(resetRedirectUrl({ dev: true, publicUrl: 'https://voxen-sohbet.pages.dev', origin: 'http://localhost:5173' }))
      .toBe('http://localhost:5173/')
  })
  it('yayında PUBLIC_URL yoksa sayfanın adresi', () => {
    expect(resetRedirectUrl({ dev: false, publicUrl: '', origin: 'https://x.dev' })).toBe('https://x.dev/')
  })
})

describe('requestPasswordReset', () => {
  it('resetPasswordForEmail hashsiz adresle çağrılır', async () => {
    const r = await requestPasswordReset('a@b.com')
    expect(r).toEqual({ ok: true })
    expect(fake.reset).toHaveBeenCalledWith('a@b.com', { redirectTo: `${location.origin}/` })
  })
  it('hız sınırı (429) Türkçe döner', async () => {
    fake.reset.mockImplementation(async () => ({ error: { status: 429, code: 'over_email_send_rate_limit', message: 'email rate limit exceeded' } }))
    expect((await requestPasswordReset('a@b.com')).error).toBe(COK_DENEME)
    fake.reset.mockImplementation(async () => ({ error: { status: 429, message: 'For security purposes, you can only request this after 45 seconds.' } }))
    expect((await requestPasswordReset('a@b.com')).error).toBe(COK_DENEME)
  })
  it('I1: gönderim hatası (500, "Error sending recovery email") adresi suçlamaz', async () => {
    fake.reset.mockImplementation(async () => ({ error: { status: 500, code: 'unexpected_failure', message: 'Error sending recovery email' } }))
    const r = await requestPasswordReset('a@b.com')
    expect(r).toEqual({ error: 'E-posta gönderilemedi. Birkaç dakika sonra tekrar dene.' })
    expect(r.alan).toBeUndefined()
  })
  it('geçersiz e-posta kutuya yazılır', async () => {
    fake.reset.mockImplementation(async () => ({ error: { status: 400, message: 'Unable to validate email address: invalid format' } }))
    expect(await requestPasswordReset('x')).toEqual({ error: 'Geçerli bir e-posta gir', alan: 'email' })
    fake.reset.mockImplementation(async () => ({ error: { status: 422, code: 'validation_failed', message: 'Email address is bad' } }))
    expect((await requestPasswordReset('x')).alan).toBe('email')
  })
})

describe('updatePassword', () => {
  it('8 karakterden kısa şifrede istek atılmaz', async () => {
    const r = await updatePassword('1234567')
    expect(r).toEqual({ error: 'Şifre en az 8 karakter olmalı', alan: 'password' })
    expect(fake.updateUser).not.toHaveBeenCalled()
  })
  it('geçerli şifre updateUser ile kaydedilir', async () => {
    expect(await updatePassword('yenisifre1')).toEqual({ ok: true })
    expect(fake.updateUser).toHaveBeenCalledWith({ password: 'yenisifre1' })
  })
  it('eskisiyle aynı şifre, zayıf şifre, hız sınırı ve süresi dolmuş oturum Türkçe', async () => {
    fake.updateUser.mockImplementation(async () => ({ error: { status: 422, code: 'same_password', message: 'New password should be different from the old password.' } }))
    expect(await updatePassword('yenisifre1')).toEqual({ error: 'Yeni şifre eskisiyle aynı olamaz. Başka bir şifre seç.', alan: 'password' })
    fake.updateUser.mockImplementation(async () => ({ error: { status: 422, code: 'weak_password', message: 'Password is known to be weak and easy to guess' } }))
    expect(await updatePassword('yenisifre1')).toEqual({ error: 'Bu şifre çok zayıf. Daha uzun bir şifre seç; harf, rakam ve işaret karıştır.', alan: 'password' })
    fake.updateUser.mockImplementation(async () => ({ error: { status: 429, message: 'Request rate limit reached' } }))
    expect((await updatePassword('yenisifre1')).error).toBe(COK_DENEME)
    fake.updateUser.mockImplementation(async () => ({ error: { status: 401, message: 'Auth session missing!' } }))
    expect((await updatePassword('yenisifre1')).error).toBe('Sıfırlama linkinin süresi doldu. "Şifremi unuttum" ile yeni link iste.')
  })
})

describe('dönüş linkini yakalama (captureRecoveryFromUrl)', () => {
  it('çıplak #sifre-yenile modu işaretlemez', () => {
    history.replaceState(null, '', '/#sifre-yenile')
    captureRecoveryFromUrl()
    expect(location.hash).toBe('#sifre-yenile')
    expect(isRecoveryPending()).toBe(false)
  })
  it('mod localStorage içinde kalır, temizlenince gider', () => {
    markRecoveryPending()
    expect(Number(localStorage.getItem('voxen.sifreYenile'))).toBeGreaterThan(0) // zaman damgası
    expect(isRecoveryPending()).toBe(true)
    clearRecoveryPending()
    expect(isRecoveryPending()).toBe(false)
  })
  it('M11: bir saatten eski işaret yok sayılır ve silinir; eski sürümün "1" değeri geçerli', () => {
    markRecoveryPending()
    expect(isRecoveryPending(Date.now() + 30 * 60 * 1000)).toBe(true)
    expect(isRecoveryPending(Date.now() + 61 * 60 * 1000)).toBe(false)
    expect(localStorage.getItem('voxen.sifreYenile')).toBeNull()
    localStorage.setItem('voxen.sifreYenile', '1')
    expect(isRecoveryPending()).toBe(true)
  })
  it('süresi dolmuş link hatası: metin bir kez alınır, adres temizlenir', () => {
    history.replaceState(null, '', '/#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid')
    captureRecoveryFromUrl()
    expect(location.hash).toBe('')
    expect(takeRecoveryLinkError()).toBe('Bu bağlantının süresi dolmuş ya da geçersiz. Yeni bir bağlantı iste.')
    expect(takeRecoveryLinkError()).toBeNull()
    expect(isRecoveryPending()).toBe(false)
  })
  it('davet linkine ve boş adrese dokunmaz', () => {
    history.replaceState(null, '', '/#/davet/KOD')
    captureRecoveryFromUrl()
    expect(location.hash).toBe('#/davet/KOD')
    expect(isRecoveryPending()).toBe(false)
  })
})
