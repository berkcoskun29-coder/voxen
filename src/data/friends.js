// Arkadaşlık ve engelleme: listeyi alma, istek gönderme/kabul/red, çıkarma, engelleme.
// Kurallar veritabanında (supabase/migrations/007_sosyal.sql): tablolar yalnız iki tarafa açık,
// yazma yalnız RPC ile. RPC'ler sabit hata kodu atar; burada spec'teki Türkçe metne çevrilir.
import { supabase } from '../lib/supabase.js'
import { fetchProfiles } from './messages.js'

// Hata kodu -> kullanıcıya gösterilecek metin (spec §1 "Arkadaş ekle" ve §2).
// Engelden gelen hata "Böyle bir kullanıcı yok." olur (veritabanı zaten NO_USER atar).
export const HATA_METINLERI = {
  NO_USER: 'Böyle bir kullanıcı yok.',
  ALREADY_FRIENDS: 'Zaten arkadaşsınız.',
  ALREADY_SENT: 'Bu kişiye zaten istek gönderdin.',
  SELF: 'Kendine istek gönderemezsin.',
  TOO_MANY: 'Çok fazla bekleyen isteğin var.',
  BLOCKED_DM: 'Bu kişiye mesaj gönderemezsin.',
  NOT_ALLOWED: 'Bu kişiye mesaj gönderemezsin.',
}
export const GENEL_HATA = 'Bir şeyler ters gitti. İnternetini kontrol edip tekrar dene.'

// Supabase hatasını Türkçe metinli Error'a çevirir. err.code: tanınan kod (yoksa null).
// ozel: bu çağrı için kod -> metin üzerine yazma (örn. arkadaşlıkta NOT_ALLOWED başka anlama gelir).
export function rpcHatasi(error, ozel = {}) {
  const ham = String(error?.message ?? '').trim()
  const metinler = { ...HATA_METINLERI, ...ozel }
  const kod = Object.hasOwn(metinler, ham) ? ham : null
  const e = new Error(kod ? metinler[kod] : GENEL_HATA)
  e.code = kod
  return e
}

// Arkadaşlık çağrılarında NOT_ALLOWED: istek artık yok (geri çekildi ya da zaten işlendi)
const ARKADAS_OZEL = { NOT_ALLOWED: 'Bu istek artık geçerli değil.' }

// Engellemede SELF'in istek cümlesi yanlış okunur
const ENGEL_OZEL = { ...ARKADAS_OZEL, SELF: 'Kendini engelleyemezsin.' }

async function cagir(ad, argumanlar, ozel = ARKADAS_OZEL) {
  const { data, error } = await supabase.rpc(ad, argumanlar)
  if (error) throw rpcHatasi(error, ozel)
  return data
}

async function benimId(selfId) {
  if (selfId) return selfId
  const { data } = await supabase.auth.getSession()
  return data?.session?.user?.id ?? null
}

const adaGore = (x, y) => String(x.username ?? '').localeCompare(String(y.username ?? ''), 'tr')
const yeniyeGore = (x, y) => String(y.created_at ?? '').localeCompare(String(x.created_at ?? ''))

// Arkadaşlar, gelen/giden istekler ve engellediklerim.
// Dönüş: { friends, incoming, outgoing, blocked }; her öğe karşı tarafın profili
// ({ id, username, color, avatar_url }) + created_at (istek/engel zamanı) [+ accepted_at].
// friends ve blocked ada göre, istekler en yenisi üstte sıralı.
export async function fetchFriends(selfId) {
  const ben = await benimId(selfId)
  // Oturum yoksa kimin "gelen" kimin "giden" olduğu bilinemez
  if (!ben) throw new Error('Giriş yapmalısın')
  const [arkadasliklar, engeller] = await Promise.all([
    supabase.from('friendships').select('*'),
    supabase.from('blocks').select('*'),
  ])
  if (arkadasliklar.error) throw new Error(arkadasliklar.error.message)
  if (engeller.error) throw new Error(engeller.error.message)

  const satirlar = arkadasliklar.data ?? []
  const engelSatirlari = (engeller.data ?? []).filter((b) => b.blocker === ben)
  const karsi = (f) => (f.user_a === ben ? f.user_b : f.user_a)

  const idler = [...new Set([...satirlar.map(karsi), ...engelSatirlari.map((b) => b.blocked)])]
  const profiller = new Map((await fetchProfiles(idler)).map((p) => [p.id, p]))
  const profil = (id) => profiller.get(id) ?? { id, username: '', color: null, avatar_url: null }

  const sonuc = { friends: [], incoming: [], outgoing: [], blocked: [] }
  for (const f of satirlar) {
    const p = { ...profil(karsi(f)), created_at: f.created_at }
    if (f.status === 'accepted') sonuc.friends.push({ ...p, accepted_at: f.accepted_at })
    else if (f.requester === ben) sonuc.outgoing.push(p)
    else sonuc.incoming.push(p)
  }
  for (const b of engelSatirlari) sonuc.blocked.push({ ...profil(b.blocked), created_at: b.created_at })

  sonuc.friends.sort(adaGore)
  sonuc.blocked.sort(adaGore)
  sonuc.incoming.sort(yeniyeGore)
  sonuc.outgoing.sort(yeniyeGore)
  return sonuc
}

// Kullanıcı adıyla istek gönderir. Dönüş: 'sent' (istek gönderildi) | 'accepted' (karşı taraf
// zaten istemişti: arkadaş oldunuz). Hatada Türkçe metinli Error (err.code: NO_USER, ...).
export async function sendFriendRequest(username) {
  return cagir('send_friend_request', { username: String(username ?? '').trim() })
}

export async function acceptFriend(otherId) {
  await cagir('accept_friend_request', { other: otherId })
}

// Gelen isteği reddeder ya da giden isteği iptal eder (aynı çağrı)
export async function declineFriend(otherId) {
  await cagir('decline_friend_request', { other: otherId })
}

export async function removeFriend(otherId) {
  await cagir('remove_friend', { other: otherId })
}

// Engeller: arkadaşlık ve bekleyen istekler de silinir
export async function blockUser(otherId) {
  await cagir('block_user', { other: otherId }, ENGEL_OZEL)
}

export async function unblockUser(otherId) {
  await cagir('unblock_user', { other: otherId })
}
