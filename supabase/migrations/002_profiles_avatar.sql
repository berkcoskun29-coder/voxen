-- Voxen 002: profil resim adresi + kayıttan önce kullanıcı adı denetimi.

alter table public.profiles add column avatar_url text;

-- Giriş yapmamış (anon) kullanıcı profilleri okuyamaz; bu fonksiyon sadece
-- "bu ad boş mu?" sorusunu yanıtlar, başka veri sızdırmaz.
create or replace function public.username_available(u text)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select not exists (select 1 from public.profiles where lower(username) = lower(u));
$$;

grant execute on function public.username_available(text) to anon, authenticated;
