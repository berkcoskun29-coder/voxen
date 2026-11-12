# Voxen

Voxen, arkadaşlarla sesli ve yazılı sohbet etmek için ücretsiz, Discord benzeri bir uygulamadır. Sunucular, yazı ve sesli kanallar, bas-konuş ve oyun içi kullanım için masaüstü sürümü vardır.

**Web sürümü:** https://voxen-sohbet.netlify.app

## Masaüstü uygulamasını kurma (Windows)

1. [GitHub Releases](https://github.com/berkcoskun29-coder/voxen/releases/latest) sayfasından en yeni sürümdeki `...-setup.exe` dosyasını indir.
2. Çalıştır. Windows SmartScreen "Windows bilgisayarınızı korudu" derse: **Ek bilgi → Yine de çalıştır**. (Program imzalı bir şirketten gelmediği için bu uyarı çıkar, zararlı değildir.)
3. Kurulum bitince Voxen açılır; pencereyi kapatırsan tepsiye iner (çıkmak için tepsi simgesi → Çıkış).

Yeni sürümler çıkınca uygulama bunu kendisi fark eder ve köşede "Yeni sürüm hazır — Güncelle" bandı gösterir. Sesli kanaldayken rahatsız etmez; sen "Güncelle"ye basana kadar hiçbir şey kurulmaz.

## İlk açılış ipuçları

- **Bas-konuş tuşu:** Ayarlar'dan harf olmayan bir tuş seç (ör. F13 veya Caps Lock). Harf tuşu seçersen yazı yazarken de mikrofon açılır.
- **Oyunun kendi sesli sohbet tuşunu seçme:** Oyundaki sesli sohbet tuşuyla aynı tuşu kullanma, çakışır.
- **Oyun yönetici olarak çalışıyorsa** Voxen'i de yönetici olarak çalıştır; yoksa oyun öndeyken bas-konuş tuşu algılanmayabilir.

## Gizlilik

- Sesli konuşmalar arkadaşlar arasında doğrudan (peer-to-peer) iletilir, bir sunucuda kaydedilmez.
- Yazılı mesajlar, sunucular ve hesap bilgileri Supabase'de saklanır.

## Geliştirici notları

```
npm install
cp .env.example .env     # Supabase adreslerini doldur
npm run dev              # web sürümü
npm test                 # testler
npm run db:push          # veritabanı şemasını gönder
npx tauri build          # masaüstü kurulum dosyası
```

Sürüm yayınlama: `npx tauri build` (imzalama ortam değişkenleriyle), ardından `node scripts/release-latest-json.mjs "notlar"`; `-setup.exe`, `.sig` ve `latest.json` GitHub Release'e (`vX.Y.Z`) yüklenir.
