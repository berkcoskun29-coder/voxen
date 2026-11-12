-- 004: Varlık (presence) kanalı yetkisi + profil kısıtları.

-- ========== 1) VARLIK KANALI ==========
-- Herkesin çevrimiçi durumu "presence:voxen" konulu tek bir Realtime kanalından geçer.
-- Eskiden kanal herkese açıktı: anon anahtarını bilen (giriş yapmamış) biri de katılıp
-- kimin çevrimiçi olduğunu ve hangi sesli kanalda olduğunu görebilir, sahte durum yayınlayabilirdi.
-- Artık kanal ÖZEL (private): yalnızca giriş yapmış kullanıcılar (authenticated) katılabilir.
-- Not: varlık anahtarı (presence key) istemcinin kendi seçtiği değerdir (Voxen kendi kullanıcı
-- id'sini verir); Realtime bu anahtarı auth.uid() ile eşleştirmeye izin vermez. Bu kurallar en azından
-- giriş yapmış olmayı şart koşar.

-- Alma: giriş yapmış kullanıcı varlık kanalına katılıp durumları görebilir
create policy presence_receive on realtime.messages
  for select to authenticated
  using (
    realtime.messages.extension = 'presence'
    and realtime.topic() = 'presence:voxen'
  );

-- Gönderme: giriş yapmış kullanıcı kendi durumunu yayınlayabilir (track)
create policy presence_send on realtime.messages
  for insert to authenticated
  with check (
    realtime.messages.extension = 'presence'
    and realtime.topic() = 'presence:voxen'
  );

-- ========== 2) PROFİL KISITLARI ==========
-- Renk: "#" + 6 onaltılık hane (örn. #3be37a). Uygulama zaten paletten seçiyor; bu kural,
-- uygulamayı atlayıp doğrudan istek atan birinin bozuk değer (CSS'e sızan metin) yazmasını önler.
alter table public.profiles
  add constraint profiles_color_hex check (color ~ '^#[0-9a-fA-F]{6}$');

-- Varsayılan renk Discord'un marka mavisiydi (#5865f2); Voxen paletinden yeşil yapıldı.
alter table public.profiles alter column color set default '#3be37a';

-- Profil resmi: boş ya da bir Supabase projesinin "avatars" deposundaki herkese açık adres.
-- (Proje adresini sabit yazmamak için her *.supabase.co projesi kabul edilir.)
alter table public.profiles
  add constraint profiles_avatar_url_storage check (
    avatar_url is null
    or avatar_url ~ '^https://[a-z0-9]+\.supabase\.co/storage/v1/object/public/avatars/'
  );

-- Kullanıcı adı büyük/küçük harf duyarsız benzersiz: "Berk" varken "berk" alınamaz.
-- (username_available zaten lower() ile bakıyordu; bu, aynı anda iki kaydın yarışını da kapatır.)
create unique index profiles_username_lower_key on public.profiles (lower(username));
