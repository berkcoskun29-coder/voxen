// DM sesli arama data katmanı (calls.js): RPC adları ve argümanları, hata çevirisi, olay ayrıştırma.
// Supabase sahte nesneyle değiştirilir, ağ kullanılmaz.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const fake = vi.hoisted(() => ({}))
vi.mock('../src/lib/supabase.js', () => {
  fake.rpc = vi.fn(async () => ({ data: null, error: null }))
  // dm_calls okuması (getCallStatus): .from().select().eq().maybeSingle()
  fake.from = vi.fn(() => {
    const z = { select: (s) => { fake.secilen = s; return z }, eq: (k, v) => { fake.filtre = [k, v]; return z }, maybeSingle: async () => fake.okuma }
    return z
  })
  return { supabase: { rpc: (...a) => fake.rpc(...a), from: (...a) => fake.from(...a) } }
})

import {
  startCall, answerCall, endCall, pingCall, parseCallEvent, mesgulMetni, callTopic, BITIS_NEDENLERI, getCallStatus,
} from '../src/data/calls.js'

const hata = (message) => async () => ({ data: null, error: { message } })
const satir = (ek = {}) => ({
  id: 'c1', thread_id: 't1', caller: 'u1', callee: 'u2', status: 'ringing',
  created_at: '2026-11-13T10:00:00Z', answered_at: null, ended_at: null,
  last_seen_at: '2026-11-13T10:00:00Z', end_reason: null, ...ek,
})

beforeEach(() => {
  fake.rpc.mockReset()
  fake.rpc.mockImplementation(async () => ({ data: null, error: null }))
})

describe('RPC adları ve argümanları', () => {
  it('startCall: start_dm_call({ tid }) -> { id, status }', async () => {
    fake.rpc.mockImplementation(async () => ({ data: satir(), error: null }))
    expect(await startCall('t1')).toEqual({ id: 'c1', status: 'ringing' })
    expect(fake.rpc).toHaveBeenCalledWith('start_dm_call', { tid: 't1' })
  })

  it('startCall: karşı taraf da arıyorduysa status active döner', async () => {
    fake.rpc.mockImplementation(async () => ({ data: satir({ id: 'c9', caller: 'u2', status: 'active' }), error: null }))
    expect(await startCall('t1')).toEqual({ id: 'c9', status: 'active' })
  })

  it('answerCall: answer_dm_call({ id }) -> { id, status }', async () => {
    fake.rpc.mockImplementation(async () => ({ data: satir({ status: 'active' }), error: null }))
    expect(await answerCall('c1')).toEqual({ id: 'c1', status: 'active' })
    expect(fake.rpc).toHaveBeenCalledWith('answer_dm_call', { id: 'c1' })
  })

  it('answerCall: arama bu arada bittiyse status ended', async () => {
    fake.rpc.mockImplementation(async () => ({ data: satir({ status: 'ended', end_reason: 'cancel' }), error: null }))
    expect(await answerCall('c1')).toEqual({ id: 'c1', status: 'ended' })
  })

  it('endCall: end_dm_call({ id, reason }) her neden için', async () => {
    expect(BITIS_NEDENLERI).toEqual(['cancel', 'decline', 'timeout', 'hangup', 'lost'])
    for (const reason of BITIS_NEDENLERI) {
      await expect(endCall('c1', reason)).resolves.toBeUndefined()
      expect(fake.rpc).toHaveBeenLastCalledWith('end_dm_call', { id: 'c1', reason })
    }
  })

  it('pingCall: ping_dm_call({ id }) -> true/false', async () => {
    fake.rpc.mockImplementation(async () => ({ data: true, error: null }))
    expect(await pingCall('c1')).toBe(true)
    expect(fake.rpc).toHaveBeenCalledWith('ping_dm_call', { id: 'c1' })
    fake.rpc.mockImplementation(async () => ({ data: false, error: null }))
    expect(await pingCall('c1')).toBe(false)
  })

  it('sinyal konusu dm-voice:<arama id>', () => {
    expect(callTopic('c1')).toBe('dm-voice:c1')
  })
})

describe('hata çevirisi', () => {
  it('BUSY: kod korunur, metin "Ad şu an başka bir aramada." (ad çağıran tarafta yerleşir)', async () => {
    fake.rpc.mockImplementation(hata('BUSY'))
    const e = await startCall('t1').catch((x) => x)
    expect(e.code).toBe('BUSY')
    expect(e.message).toBe('Ad şu an başka bir aramada.')
    expect(mesgulMetni('Ayla')).toBe('Ayla şu an başka bir aramada.')
  })

  it('ALREADY_IN_CALL: kod korunur, metin "Zaten bir aramadasın."', async () => {
    fake.rpc.mockImplementation(hata('ALREADY_IN_CALL'))
    const e = await startCall('t1').catch((x) => x)
    expect(e.code).toBe('ALREADY_IN_CALL')
    expect(e.message).toBe('Zaten bir aramadasın.')
  })

  it('engel: engelleyen BLOCKED_DM, engellenen NOT_ALLOWED; ikisi aynı metin (007 gibi)', async () => {
    fake.rpc.mockImplementation(hata('BLOCKED_DM'))
    const e1 = await startCall('t1').catch((x) => x)
    fake.rpc.mockImplementation(hata('NOT_ALLOWED'))
    const e2 = await startCall('t1').catch((x) => x)
    expect(e1.code).toBe('BLOCKED_DM')
    expect(e2.code).toBe('NOT_ALLOWED')
    expect(e1.message).toBe('Bu kişiye mesaj gönderemezsin.')
    expect(e2.message).toBe(e1.message)
  })

  it('tanınmayan hata genel metin, kod null', async () => {
    fake.rpc.mockImplementation(hata('Failed to fetch'))
    const e = await answerCall('c1').catch((x) => x)
    expect(e.code).toBeNull()
    expect(e.message).toBe('Bir şeyler ters gitti. İnternetini kontrol edip tekrar dene.')
  })

  it('answer/end/ping hataları da çevrilir', async () => {
    fake.rpc.mockImplementation(hata('NOT_ALLOWED'))
    for (const f of [() => answerCall('c1'), () => endCall('c1', 'hangup'), () => pingCall('c1')]) {
      const e = await f().catch((x) => x)
      expect(e).toBeInstanceOf(Error)
      expect(e.code).toBe('NOT_ALLOWED')
    }
  })
})

describe('parseCallEvent', () => {
  it('"arama" yükü -> { callId, threadId, status, caller, reason }', () => {
    expect(parseCallEvent({ call_id: 'c1', thread_id: 't1', status: 'ringing', caller: 'u1', reason: null }))
      .toEqual({ callId: 'c1', threadId: 't1', status: 'ringing', caller: 'u1', reason: null })
    expect(parseCallEvent({ call_id: 'c1', thread_id: 't1', status: 'ended', caller: 'u1', reason: 'decline' }))
      .toEqual({ callId: 'c1', threadId: 't1', status: 'ended', caller: 'u1', reason: 'decline' })
  })

  it('eksik alanlar null olur', () => {
    expect(parseCallEvent({ call_id: 'c1', thread_id: 't1', status: 'active' }))
      .toEqual({ callId: 'c1', threadId: 't1', status: 'active', caller: null, reason: null })
  })

  it('bozuk yük null', () => {
    expect(parseCallEvent(null)).toBeNull()
    expect(parseCallEvent({})).toBeNull()
    expect(parseCallEvent({ tablo: 'friendships', islem: 'INSERT' })).toBeNull()
    expect(parseCallEvent({ call_id: 'c1', thread_id: 't1', status: 'bilinmez' })).toBeNull()
  })
})

describe('getCallStatus (kaçan "arama" olayını telafi)', () => {
  it('dm_calls satırından status ve end_reason okur; satır yoksa null; hata fırlatır', async () => {
    fake.okuma = { data: { status: 'active', end_reason: null }, error: null }
    expect(await getCallStatus('c1')).toEqual({ status: 'active', reason: null })
    expect(fake.from).toHaveBeenCalledWith('dm_calls')
    expect(fake.secilen).toBe('status, end_reason')
    expect(fake.filtre).toEqual(['id', 'c1'])
    fake.okuma = { data: { status: 'ended', end_reason: 'decline' }, error: null }
    expect(await getCallStatus('c1')).toEqual({ status: 'ended', reason: 'decline' })
    fake.okuma = { data: null, error: null }
    expect(await getCallStatus('c1')).toBeNull()
    fake.okuma = { data: null, error: { message: 'ağ' } }
    await expect(getCallStatus('c1')).rejects.toThrow()
  })
})
