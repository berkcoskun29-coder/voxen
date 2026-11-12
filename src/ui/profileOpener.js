// Profil kartını açan öğeleri (avatar, ad) işaretler. Çizen dosyalar (üye listesi, sohbet,
// sesli kanaldakiler) yalnız bunu çağırır; tıklamayı tek bir dinleyici yakalar (profileCard.js).
// Ayrı dosyada: profileCard.js memberList.js'i kullandığı için döngüsel içe aktarma olmasın.

const kisiler = new WeakMap() // işaretli öğe -> o kişinin profili

// el: tıklanınca kartı açacak öğe. kisi: profil { id, username, color, avatar_url }.
// odakAnahtari: kart kapanınca odak geri dönsün diye (öğe bu arada yeniden çizildiyse aynı anahtarlı yeniye).
// Klavyeyle de açılsın diye düğme gibi davranır (role=button, Tab ile gelinir, Enter/Boşluk açar).
// yalnizFare: true ise yalnız fareyle tıklanır (role/aria-label/tabindex yok). Sohbetteki yazar adı
// için: aria-label görünen adın yerine geçerdi; klavye ve ekran okuyucu için avatar yeterli.
// tabsiz: true ise düğme gibi davranır ama Tab durağı olmaz (uzun sohbette onlarca avatar Tab'ı doldurmasın;
// klavye kullanıcısı üye listesinden ulaşır).
export function makeProfileOpener(el, kisi, odakAnahtari, { yalnizFare = false, tabsiz = false } = {}) {
  if (!kisi?.id) return el // "Bilinmeyen" yazar gibi kimliksiz profiller için kart yok
  kisiler.set(el, kisi)
  el.dataset.profileOpener = kisi.id
  if (yalnizFare) return el
  el.setAttribute('role', 'button')
  el.tabIndex = tabsiz ? -1 : 0
  el.setAttribute('aria-haspopup', 'dialog')
  el.setAttribute('aria-label', `${kisi.username} profilini göster`)
  if (odakAnahtari) el.dataset.odak = odakAnahtari
  return el
}

// İşaretli öğenin kişisi (yoksa null)
export function profileOpenerPerson(el) {
  return kisiler.get(el) ?? null
}
