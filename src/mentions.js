// @bahsetme eşleşmesi (saf fonksiyonlar; DOM yok). Kural veritabanındaki mentions_user ile AYNI
// (supabase/migrations/007_sosyal.sql):
//  - "@" + kullanıcı adı, büyük-küçük harf duyarsız.
//  - "@"tan önce metnin başı ya da harf/rakam/_ OLMAYAN bir karakter: "a@berk" (e-posta gibi) anmaz.
//  - Addan sonra metnin sonu ya da harf/rakam/_ OLMAYAN bir karakter: "@berk", "@berkcan"ı anmaz;
//    "@berk." ve "@berk," anar.
//  - Harf/rakam her dilde (\p{L}\p{N}, "u" bayrağıyla): "@berkç" de "@berk"i anmaz.
//  - Kullanıcı adında her karakter olabilir (yalnız 3–20 uzunluk kuralı var; boşluk ve nokta da),
//    bu yüzden addaki düzenli ifade işaretleri kaçırılır.
// Bildirimler (Task 5) de mentionsUser'ı kullanır.

// "u" bayrağında yalnız bu işaretler "\" ile kaçırılabilir (başka karakteri kaçırmak hata verir)
const kacir = (s) => s.replace(/[\\^$.*+?()[\]{}|/]/g, '\\$&')

// Ad -> düzenli ifade (her mesajda yeniden kurulmasın; matchAll ifadeyi kopyaladığı için paylaşmak güvenli)
const onbellek = new Map()
function ifade(ad) {
  let re = onbellek.get(ad)
  if (!re) {
    if (onbellek.size > 500) onbellek.clear() // sınırsız büyümesin
    re = new RegExp(`(?<![\\p{L}\\p{N}_])@${kacir(ad)}(?![\\p{L}\\p{N}_])`, 'giu')
    onbellek.set(ad, re)
  }
  return re
}

// Metin bu kullanıcı adını anıyor mu? (true/false)
export function mentionsUser(text, username) {
  if (!text || !username || !text.includes('@')) return false
  return !text.matchAll(ifade(username)).next().done
}

// Metindeki bahsetmeleri bulur. usernames: aranacak adlar (ör. sunucu üyeleri).
// Dönüş: [{ start, end, username }] başlangıca göre sıralı, çakışmasız. username listedeki yazımıyla gelir.
// Aynı yerden iki ad eşleşirse ("@Berk" ve "@Berk Can") uzun olan alınır.
export function findMentions(text, usernames) {
  if (!text || !text.includes('@') || !usernames?.length) return []
  const adaylar = []
  for (const ad of new Set(usernames)) {
    if (!ad) continue
    for (const e of text.matchAll(ifade(ad))) adaylar.push({ start: e.index, end: e.index + e[0].length, username: ad })
  }
  adaylar.sort((a, b) => a.start - b.start || b.end - a.end)
  const sonuc = []
  let sinir = 0
  for (const a of adaylar) {
    if (a.start < sinir) continue // öncekiyle çakışıyor
    sonuc.push(a)
    sinir = a.end
  }
  return sonuc
}

// @herkes / @everyone (v0.11.0). Kural veritabanındaki mentions_everyone ile AYNI
// (supabase/migrations/013_roller.sql): mentionsUser'daki kelime sınırı, büyük-küçük harf duyarsız.
// Bildirim ve sayaç yalnız yazarın MENTION_EVERYONE izni varsa; bunu çağıran denetler.
const HERKES = /(?<![\p{L}\p{N}_])@(herkes|everyone)(?![\p{L}\p{N}_])/iu
export function mentionsEveryone(text) {
  if (!text || !text.includes('@')) return false
  return HERKES.test(text)
}
