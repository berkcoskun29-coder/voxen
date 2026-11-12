// SDP (bağlantı tarifi) yardımcıları. Saf fonksiyonlar: tarayıcı gerektirmez.

// Opus ses kodlayıcısının ayar satırını (a=fmtp) düzenler:
//   maxaveragebitrate -> en fazla ortalama bit hızı (bit/sn)
//   useinbandfec      -> paket kaybında sesi onaran FEC açık/kapalı
//   stereo            -> çift kanal (sesli sohbette tek kanal yeter)
// Satırdaki diğer ayarlar (ör. minptime=10) korunur.
export function tuneOpus(sdp, { bitrateKbps = 128, fec = true, stereo = false } = {}) {
  const satirSonu = sdp.includes('\r\n') ? '\r\n' : '\n'
  const satirlar = sdp.split(satirSonu)

  // Opus'un numarasını (payload type) bul: "a=rtpmap:111 opus/48000/2"
  const rtpmapIndex = satirlar.findIndex((l) => /^a=rtpmap:\d+ opus\/48000/i.test(l))
  if (rtpmapIndex === -1) return sdp // Opus yoksa dokunma
  const pt = satirlar[rtpmapIndex].match(/^a=rtpmap:(\d+)/)[1]

  const yeniAyarlar = {
    maxaveragebitrate: String(Math.round(bitrateKbps * 1000)),
    useinbandfec: fec ? '1' : '0',
    stereo: stereo ? '1' : '0',
  }

  const onEk = `a=fmtp:${pt} `
  const fmtpIndex = satirlar.findIndex((l) => l.startsWith(onEk))
  if (fmtpIndex === -1) {
    // Ayar satırı yok: rtpmap satırının hemen altına ekle
    const metin = Object.entries(yeniAyarlar).map(([k, v]) => `${k}=${v}`).join(';')
    satirlar.splice(rtpmapIndex + 1, 0, onEk + metin)
  } else {
    // Var olan ayarları sırasıyla oku, bizimkileri güncelle ya da sona ekle
    const ayarlar = new Map()
    for (const parca of satirlar[fmtpIndex].slice(onEk.length).split(';')) {
      if (!parca.trim()) continue
      const [k, ...v] = parca.split('=')
      ayarlar.set(k.trim(), v.join('='))
    }
    for (const [k, v] of Object.entries(yeniAyarlar)) ayarlar.set(k, v)
    satirlar[fmtpIndex] = onEk + [...ayarlar].map(([k, v]) => `${k}=${v}`).join(';')
  }
  return satirlar.join(satirSonu)
}

// İki kişiden hangisi bağlantıyı başlatır (teklifi gönderir)?
// Kimliği alfabetik olarak küçük olan. Böylece iki taraf aynı anda aramaz.
export function shouldInitiate(myId, peerId) {
  return myId < peerId
}
