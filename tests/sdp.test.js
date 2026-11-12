// SDP yardımcıları: Opus ayarları ve kimin arayacağı.
import { describe, it, expect } from 'vitest'
import { tuneOpus, shouldInitiate } from '../src/voice/sdp.js'

// Tarayıcının ürettiğine benzer küçük bir SDP (satır sonları \r\n)
const SDP = [
  'v=0',
  'm=audio 9 UDP/TLS/RTP/SAVPF 111 0',
  'a=rtpmap:111 opus/48000/2',
  'a=fmtp:111 minptime=10;useinbandfec=0',
  'a=rtpmap:0 PCMU/8000',
  '',
].join('\r\n')

describe('tuneOpus', () => {
  it('tuneOpus 128 kbps ve FEC ekler, mevcut fmtp parametrelerini korur', () => {
    const s = tuneOpus(SDP, { bitrateKbps: 128, fec: true })
    const fmtp = s.split('\r\n').find((l) => l.startsWith('a=fmtp:111'))
    expect(fmtp).toContain('minptime=10')
    expect(fmtp).toContain('maxaveragebitrate=128000')
    expect(fmtp).toContain('useinbandfec=1')
    expect(fmtp).toContain('stereo=0')
    expect(fmtp).not.toContain('useinbandfec=0') // güncellendi, tekrar eklenmedi
    expect(s.endsWith('\r\n')).toBe(true) // satır sonları bozulmadı
    expect(s).toContain('a=rtpmap:0 PCMU/8000') // diğer satırlar aynen kalır
  })

  it('varsayılanlar 128 kbps + FEC; tekrar çağrılınca parametre çoğalmaz', () => {
    const s = tuneOpus(tuneOpus(SDP, { bitrateKbps: 64 }))
    const fmtp = s.split('\r\n').find((l) => l.startsWith('a=fmtp:111'))
    expect(fmtp.match(/maxaveragebitrate/g)).toHaveLength(1)
    expect(fmtp).toContain('maxaveragebitrate=128000')
  })

  it('stereo ve FEC kapatılabilir', () => {
    const s = tuneOpus(SDP, { bitrateKbps: 32, fec: false, stereo: true })
    expect(s).toContain('maxaveragebitrate=32000')
    expect(s).toContain('useinbandfec=0')
    expect(s).toContain('stereo=1')
  })

  it('fmtp satırı yoksa rtpmap satırının altına eklenir', () => {
    const yok = SDP.replace('a=fmtp:111 minptime=10;useinbandfec=0\r\n', '')
    const satirlar = tuneOpus(yok).split('\r\n')
    const i = satirlar.indexOf('a=rtpmap:111 opus/48000/2')
    expect(satirlar[i + 1]).toBe('a=fmtp:111 maxaveragebitrate=128000;useinbandfec=1;stereo=0')
  })

  it('Opus yoksa SDP aynen döner', () => {
    const s = 'v=0\r\nm=audio 9 RTP 0\r\na=rtpmap:0 PCMU/8000\r\n'
    expect(tuneOpus(s)).toBe(s)
  })
})

describe('shouldInitiate', () => {
  it('shouldInitiate yalnızca bir taraf için true', () => {
    const a = '1b2c-aaaa'
    const b = '9f00-bbbb'
    expect(shouldInitiate(a, b)).toBe(true)
    expect(shouldInitiate(b, a)).toBe(false)
    expect(shouldInitiate(a, b) !== shouldInitiate(b, a)).toBe(true)
  })
})
