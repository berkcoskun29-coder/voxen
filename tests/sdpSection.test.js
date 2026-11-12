// SDP m-satırı yardımcıları (2. aşama): bölüm bazında Opus ayarı ve mid sırası.
import { describe, it, expect } from 'vitest'
import { tuneOpusSection, midOrder } from '../src/voice/sdp.js'

const SDP = [
  'v=0',
  'm=audio 9 UDP/TLS/RTP/SAVPF 111',
  'a=mid:0',
  'a=rtpmap:111 opus/48000/2',
  'a=fmtp:111 minptime=10',
  'm=video 9 UDP/TLS/RTP/SAVPF 96',
  'a=mid:1',
  'a=rtpmap:96 VP8/90000',
  'm=audio 9 UDP/TLS/RTP/SAVPF 111',
  'a=mid:2',
  'a=rtpmap:111 opus/48000/2',
  'a=fmtp:111 minptime=10',
  '',
].join('\r\n')

describe('tuneOpusSection / midOrder', () => {
  it('yalnız seçilen m-satırının Opus ayarını değiştirir', () => {
    const s = tuneOpusSection(SDP, 2, { bitrateKbps: 128, stereo: true })
    const fmtp = s.split('\r\n').filter((l) => l.startsWith('a=fmtp:111'))
    expect(fmtp[0]).toBe('a=fmtp:111 minptime=10') // 0. satır (mikrofon) aynen
    expect(fmtp[1]).toContain('stereo=1')
    expect(fmtp[1]).toContain('maxaveragebitrate=128000')
    expect(s.endsWith('\r\n')).toBe(true)
    expect(s.split('\r\n')).toHaveLength(SDP.split('\r\n').length)
  })

  it('olmayan bölüm için SDP aynen döner', () => {
    expect(tuneOpusSection(SDP, 7, { stereo: true })).toBe(SDP)
  })

  it('midOrder m-satırı sırasını verir', () => {
    expect(midOrder(SDP)).toEqual(['0', '1', '2'])
    expect(midOrder(null)).toEqual([])
  })
})
