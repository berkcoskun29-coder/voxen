// Çevrimdışı şema testi (tests/schema.test.js kalıbı): 015 bildirimler (v0.13.0)
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'

const yol = 'supabase/migrations/015_bildirimler.sql'
const ham = existsSync(yol) ? readFileSync(yol, 'utf8') : ''
const sql = ham.replace(/--[^\n]*/g, '').toLowerCase().replace(/\s+/g, ' ')
const fonk = (ad) => {
  const i = sql.search(new RegExp(`create (or replace )?function public\\.${ad}\\(`))
  if (i < 0) return ''
  const govdeBasi = sql.indexOf('$$', i)
  return sql.slice(i, sql.indexOf('$$;', govdeBasi + 2) + 3)
}
const politika = (ad) => {
  const i = sql.indexOf(`create policy ${ad} `)
  return i < 0 ? '' : sql.slice(i, sql.indexOf(';', i) + 1)
}

describe('015_bildirimler.sql', () => {
  it('dosya var', () => expect(existsSync(yol)).toBe(true))

  it('yalnız ekleme: var olan tablo/sütun/fonksiyon değişmez', () => {
    expect(sql).not.toMatch(/drop column|rename column|rename to|drop table|alter column|drop function|alter table public\.(messages|channels|servers|channel_reads|dm_mutes|server_mutes)/)
    // Var olan RPC'ler yeniden tanımlanmaz (dönüşleri aynı kalır)
    for (const ad of ['unread_counts', 'mark_read', 'dm_list', 'group_dm_list']) expect(fonk(ad), ad).toBe('')
  })

  it('server_notify_levels: düzey kısıtı, RLS açık, yalnız kendi satırları, yazarken üyelik', () => {
    expect(sql).toContain('create table if not exists public.server_notify_levels')
    expect(sql).toContain("level text not null check (level in ('all', 'mentions', 'none'))")
    expect(sql).toContain('server_id uuid not null references public.servers(id) on delete cascade')
    expect(sql).toContain('primary key (user_id, server_id)')
    expect(sql).toContain('alter table public.server_notify_levels enable row level security')
    expect(politika('server_notify_levels_select')).toContain('using (user_id = auth.uid())')
    expect(politika('server_notify_levels_insert')).toContain('with check (user_id = auth.uid() and public.is_member(server_id))')
    expect(politika('server_notify_levels_update')).toContain('using (user_id = auth.uid())')
    expect(politika('server_notify_levels_update')).toContain('with check (user_id = auth.uid() and public.is_member(server_id))')
    expect(politika('server_notify_levels_delete')).toContain('using (user_id = auth.uid())')
  })

  it('channel_notify_prefs: düzey null olabilir, sessizlik ve süre, RLS, yazılı kanal + üyelik', () => {
    expect(sql).toContain('create table if not exists public.channel_notify_prefs')
    expect(sql).toContain("level text check (level is null or level in ('all', 'mentions', 'none'))")
    expect(sql).toContain('muted boolean not null default false')
    expect(sql).toContain('muted_until timestamptz')
    expect(sql).toContain('channel_id uuid not null references public.channels(id) on delete cascade')
    expect(sql).toContain('check (muted or muted_until is null)')
    expect(sql).toContain('alter table public.channel_notify_prefs enable row level security')
    expect(politika('channel_notify_prefs_select')).toContain('using (user_id = auth.uid())')
    for (const p of ['channel_notify_prefs_insert', 'channel_notify_prefs_update']) {
      expect(politika(p), p).toContain("c.id = channel_id and c.kind = 'text' and public.is_member(c.server_id)")
      expect(politika(p), p).toContain('user_id = auth.uid()')
    }
    expect(politika('channel_notify_prefs_delete')).toContain('using (user_id = auth.uid())')
  })

  it('mark_server_read: security definer, üyelik (NOT_ALLOWED), yalnız ileri, yazılı kanallar', () => {
    const f = fonk('mark_server_read')
    expect(f).toContain('returns int')
    expect(f).toContain('security definer')
    expect(f).toContain('set search_path = public')
    expect(f).toContain("not public.is_member(sid) then raise exception 'not_allowed'")
    expect(f).toContain("where c.server_id = sid and c.kind = 'text'")
    // Yalnız ileri ve yalnız değişen satır (tur 1, K2)
    expect(f).toContain('do update set last_read_id = excluded.last_read_id where excluded.last_read_id > r.last_read_id')
    expect(f).not.toContain('greatest(')
    expect(sql).toContain('revoke all on function public.mark_server_read(uuid) from public, anon')
    expect(sql).toContain('grant execute on function public.mark_server_read(uuid) to authenticated')
  })
})
