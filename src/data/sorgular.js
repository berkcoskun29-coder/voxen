// Mesaj sorgularının select metinleri (tek kaynak). Bu dosya hiçbir şey içe aktarmaz:
// doğrulama betikleri (tasarim/_araclar/dogrula-0NN.mjs) de Node'da doğrudan kullanır.

// Mesajın ekleri (010): attachments tablosu, mesaja tek FK (message_id / dm_message_id)
export const EK_SECIMI = 'id, path, name, mime, size, width, height, uploader'

// Kanal mesajı: tepkiler, sabit bilgisi (009) ve ekler (010) gömülü; ek sorgu yok.
//   reactions: [{ emoji, user_id }]   pin: { pinned_at, pinned_by } | null   attachments: [{ ... }]
export const MESAJ_SECIMI = `*, reactions:message_reactions(emoji, user_id), pin:message_pins(pinned_at, pinned_by), attachments(${EK_SECIMI})`

// DM karşılığı
export const DM_MESAJ_SECIMI = `*, reactions:dm_message_reactions(emoji, user_id), pin:dm_message_pins(pinned_at, pinned_by), attachments(${EK_SECIMI})`
