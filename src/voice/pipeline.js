// Ses hattı: mikrofon -> (RNNoise) -> kapı (GainNode) -> çıkış akışı.
// Fazladan tampon yok: gecikme sadece RNNoise'ın kendi çerçevesi (10 ms) kadardır.
import rnnoiseWorkletPath from '@sapphi-red/web-noise-suppressor/rnnoiseWorklet.js?url'
import rnnoiseWasmPath from '@sapphi-red/web-noise-suppressor/rnnoise.wasm?url'
import rnnoiseSimdWasmPath from '@sapphi-red/web-noise-suppressor/rnnoise_simd.wasm?url'
import { rmsLevel } from './level.js'

// Hata sözleşmesi: openMic her zaman `code` alanı olan bir MicError fırlatır.
//   code 'denied' -> izin verilmedi, code 'no-mic' -> mikrofon yok
export class MicError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'MicError'
    this.code = code
  }
}

// Arayüzde gösterilecek Türkçe metinler
export const MIC_MESSAGES = {
  denied: 'Mikrofon izni verilmedi',
  'no-mic': 'Mikrofon bulunamadı',
}

// Mikrofonu açar. Tarayıcının kendi yankı/otomatik kazanç özelliği açık,
// gürültü engelleme kapalıdır (onu RNNoise yapacak).
export async function openMic(deviceId) {
  const audio = { echoCancellation: true, noiseSuppression: false, autoGainControl: true, channelCount: 1 }
  if (deviceId) audio.deviceId = { exact: deviceId }
  try {
    return await navigator.mediaDevices.getUserMedia({ audio })
  } catch (e) {
    if (e?.name === 'NotAllowedError' || e?.name === 'SecurityError') throw new MicError('denied', MIC_MESSAGES.denied)
    if (e?.name === 'NotFoundError' || e?.name === 'OverconstrainedError') throw new MicError('no-mic', MIC_MESSAGES['no-mic'])
    throw e
  }
}

// Gerçek RNNoise düğümünü kurar (testlerde deps.createRnnoise ile değiştirilir)
// Paket yüklenirken AudioWorkletNode ister (jsdom'da yok), bu yüzden dinamik import.
async function rnnoiseOlustur(ctx) {
  const { loadRnnoise, RnnoiseWorkletNode } = await import('@sapphi-red/web-noise-suppressor')
  const wasmBinary = await loadRnnoise({ url: rnnoiseWasmPath, simdUrl: rnnoiseSimdWasmPath })
  await ctx.audioWorklet.addModule(rnnoiseWorkletPath)
  return new RnnoiseWorkletNode(ctx, { wasmBinary, maxChannels: 1 })
}

// micStream: openMic'ten gelen akış. deps sadece testler içindir.
// Not: worklet yüklemek asenkron olduğu için Promise döner.
export async function createVoicePipeline(micStream, { noiseSuppression = true } = {}, deps = {}) {
  const Ctx = deps.AudioContext ?? globalThis.AudioContext
  const ctx = new Ctx({ sampleRate: 48000 }) // RNNoise 48 kHz ister
  let rnnoise
  try {
    rnnoise = await (deps.createRnnoise ?? rnnoiseOlustur)(ctx)
    // Bağlam await'lerden sonra 'suspended' başlayabilir; uyandırmazsak ses sessiz kalır
    if (ctx.state === 'suspended') await ctx.resume()
  } catch (e) {
    // Kurulum bozulduysa mikrofon göstergesi açık kalmasın, bağlam sızmasın
    micStream.getTracks().forEach((t) => t.stop())
    ctx.close()
    throw e
  }

  const source = ctx.createMediaStreamSource(micStream)
  const analyser = ctx.createAnalyser() // seviye ölçer, kapıdan ÖNCE
  analyser.fftSize = 1024
  const gate = ctx.createGain()
  const dest = ctx.createMediaStreamDestination()
  gate.connect(dest)

  let ns = noiseSuppression

  // Bağlantıyı (yeniden) kurar; bağlamı yeniden yaratmaya gerek yok.
  function baglan() {
    source.disconnect()
    rnnoise.disconnect()
    const girdi = ns ? rnnoise : source // engelleme kapalıysa RNNoise atlanır
    if (ns) source.connect(rnnoise)
    girdi.connect(analyser)
    girdi.connect(gate)
  }
  baglan()

  const buf = new Float32Array(analyser.fftSize)
  return {
    outputStream: dest.stream,
    setNoiseSuppression(acik) { ns = !!acik; baglan() },
    // Kapı kapalıyken kazanç 0: karşıya ses gitmez
    setGate(acik) { gate.gain.value = acik ? 1 : 0 },
    gateGain() { return gate.gain.value },
    getLevel() {
      analyser.getFloatTimeDomainData(buf)
      return rmsLevel(buf)
    },
    close() {
      micStream.getTracks().forEach((t) => t.stop())
      rnnoise.destroy?.()
      ctx.close()
    },
  }
}
