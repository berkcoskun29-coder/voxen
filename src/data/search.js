// Mesaj arama (v0.10.0): search_messages RPC'si (supabase/migrations/012_mesaj_arama.sql).
// Kural veritabanında: yalnız çağıranın görebildiği mesajlar (sunucu üyeliği, DM tarafı, şu an üye olunan
// grup), silinmişler ve DM sistem satırları hariç, en yeniden eskiye.
import { supabase } from '../lib/supabase.js'
import { rpcHatasi } from './friends.js'
import { ARAMA_SAYFA, ARAMA_UYARILARI } from './aramaFiltre.js'

export const ARAMA_HATA_METINLERI = {
  NOT_ALLOWED: 'Burada arama yapamazsın.',
  TOO_SHORT: ARAMA_UYARILARI.kisa,
  BAD_QUERY: ARAMA_UYARILARI.uzun,
}

// kapsam: { tur: 'sunucu', id } | { tur: 'dm' }. cozum: aramaCozumle() sonucu. oncesi: imleç (son sonucun id'si).
// Bir sayfa (25) ister; 26. satır "daha var" demektir (gösterilmez).
// Dönüş: { sonuclar: [satır], dahaVar }. Satır alanları: id, tur ('channel'|'dm'), channel_id, server_id, thread_id,
// is_group, yer_adi, other_id, author_id, author_name, content, created_at, attachment_count.
// Hatada Türkçe metinli Error (err.code: NOT_ALLOWED | TOO_SHORT | BAD_QUERY | null).
export async function searchMessages(kapsam, cozum, { oncesi = null } = {}) {
  const sunucu = kapsam?.tur === 'sunucu' ? kapsam.id : null
  const { data, error } = await supabase.rpc('search_messages', {
    sorgu: cozum.metin ?? '',
    sunucu,
    kanal_adi: sunucu ? (cozum.kanal ?? null) : null,
    yazar_adi: cozum.kimden ?? null,
    once_tarih: cozum.once ?? null,
    sonra_tarih: cozum.sonra ?? null,
    ekli: cozum.ek ? true : null,
    oncesi,
    sinir: ARAMA_SAYFA + 1,
  })
  if (error) throw rpcHatasi(error, ARAMA_HATA_METINLERI)
  const satirlar = data ?? []
  return { sonuclar: satirlar.slice(0, ARAMA_SAYFA), dahaVar: satirlar.length > ARAMA_SAYFA }
}
