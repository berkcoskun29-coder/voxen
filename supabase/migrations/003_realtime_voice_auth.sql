-- 003: Sesli kanal sinyali için Realtime yetkilendirmesi.
-- Sesli kanalın tanışma mesajları "voice:<kanal uuid>" konulu ÖZEL (private) bir Realtime
-- kanalından geçer. Bu kurallar olmadan, anon anahtarı ve kanal kimliğini bilen herkes
-- "hello" gönderip üyelerin mikrofon sesini alabilirdi.
-- Kural: konu voice:<uuid> olmalı, o uuid bir SESLİ kanal olmalı ve o kanalın sunucusunda
-- giriş yapmış kullanıcı (auth.uid()) üye olmalı. presence:voxen ve mesaj kanalları değişmedi
-- (onlar private değil, bu politikalardan etkilenmez).

-- Konu denetimi. Bozuk konu (uuid değilse) hata fırlatmaz, false döner.
create or replace function public.can_access_voice_topic(topic text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  kanal_id uuid;
begin
  if topic is null
     or topic !~* '^voice:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;
  kanal_id := substring(topic from 7)::uuid; -- "voice:" (6 karakter) sonrası
  return exists (
    select 1 from public.channels c
    where c.id = kanal_id
      and c.kind = 'voice'
      and public.is_member(c.server_id)
  );
end;
$$;

revoke all on function public.can_access_voice_topic(text) from public;
grant execute on function public.can_access_voice_topic(text) to authenticated;

-- Alma: üye olan, o konudaki yayın/varlık mesajlarını alabilir (kanala katılabilir)
create policy voice_receive on realtime.messages
  for select to authenticated
  using (
    realtime.messages.extension in ('broadcast', 'presence')
    and public.can_access_voice_topic(realtime.topic())
  );

-- Gönderme: üye olan, o konuya yayın/varlık mesajı gönderebilir
create policy voice_send on realtime.messages
  for insert to authenticated
  with check (
    realtime.messages.extension in ('broadcast', 'presence')
    and public.can_access_voice_topic(realtime.topic())
  );
