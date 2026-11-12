-- 005: Sesli kanal durumu ayrı tabloda (voice_states).
-- Eskiden "kim hangi sesli kanalda, susturulmuş mu, kamerası açık mı" bilgisi varlık (presence)
-- kanalından gidiyordu. Supabase bir istemciye 30 saniyede en fazla 5 varlık çağrısı izin verir;
-- aşılınca kanalı kapatır ve son durum kimseye ulaşmaz (hızlı Sustur/Sağırlaştır'da simge takılıyordu).
-- Artık her kişinin sesli durumu bu tabloda TEK SATIR: katılınca yazılır, değişince güncellenir,
-- ayrılınca silinir. Değişiklikler Realtime (postgres_changes) ile o sunucunun üyelerine gider.
-- Varlık kanalında yalnızca çevrimiçi durumu kalır.

create table public.voice_states (
  user_id uuid primary key references auth.users on delete cascade, -- kişi başı en fazla bir satır
  server_id uuid not null references public.servers on delete cascade,
  channel_id uuid not null references public.channels on delete cascade,
  client_id text not null, -- hangi pencere/program (aynı hesap iki pencerede açıksa ayırt etmek için)
  muted boolean not null default false,
  deafened boolean not null default false,
  camera boolean not null default false,
  screen boolean not null default false,
  updated_at timestamptz not null default now()
);

alter table public.voice_states enable row level security;

-- Kanal gerçekten bu sunucunun SESLİ kanalı mı? (yazma kurallarında kullanılır)
create function public.is_voice_channel_of(cid uuid, sid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.channels c
    where c.id = cid and c.server_id = sid and c.kind = 'voice'
  );
$$;

revoke all on function public.is_voice_channel_of(uuid, uuid) from public;
grant execute on function public.is_voice_channel_of(uuid, uuid) to authenticated;

-- Okuma: sunucunun üyeleri o sunucudaki sesli durumları görür
create policy voice_states_select on public.voice_states
  for select to authenticated
  using (public.is_member(server_id));

-- Ekleme: yalnız kendi satırı, üyesi olduğu sunucunun sesli kanalı için
create policy voice_states_insert on public.voice_states
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and public.is_member(server_id)
    and public.is_voice_channel_of(channel_id, server_id)
  );

-- Güncelleme: yalnız kendi satırı; yeni değerler de aynı kurallara uymalı
create policy voice_states_update on public.voice_states
  for update to authenticated
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and public.is_member(server_id)
    and public.is_voice_channel_of(channel_id, server_id)
  );

-- Silme: yalnız kendi satırı. (Üyelik şartı yok: sunucudan çıkarılan biri de eski satırını silebilsin.)
create policy voice_states_delete on public.voice_states
  for delete to authenticated
  using (user_id = auth.uid());

-- updated_at her güncellemede kendiliğinden yenilenir (istemcinin saatine güvenmeyiz)
create function public.voice_states_touch()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger voice_states_touch
  before update on public.voice_states
  for each row execute function public.voice_states_touch();

-- Realtime: değişiklikler abonelere gitsin. Silme olaylarında eski satırın tamamı gelsin diye
-- REPLICA IDENTITY FULL (RLS açıkken Realtime silmede yine de yalnız birincil anahtarı verebilir;
-- istemci silmeyi user_id ile işler).
alter table public.voice_states replica identity full;
alter publication supabase_realtime add table public.voice_states;
