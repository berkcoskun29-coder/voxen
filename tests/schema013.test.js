// Çevrimdışı şema testi (tests/schema.test.js kalıbı): 013 roller ve izinler (v0.11.0)
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { IZIN_ADLARI, ROL_RENK_ADLARI, EN_UST_SIRA, ROL_SINIRI } from '../src/data/rolKurallari.js'

const yol = 'supabase/migrations/013_roller.sql'
const ham = existsSync(yol) ? readFileSync(yol, 'utf8') : ''
// Yorumlar atılır (yorumdaki "owner_id = auth.uid()" gibi sözler testi yanıltmasın)
const sql = ham.replace(/--[^\n]*/g, '').toLowerCase().replace(/\s+/g, ' ')
const fonk = (ad, metin = sql) => {
  const i = metin.search(new RegExp(`create (or replace )?function public\\.${ad}\\(`))
  if (i < 0) return ''
  const govdeBasi = metin.indexOf('$$', i)
  return metin.slice(i, metin.indexOf('$$;', govdeBasi + 2) + 3)
}
const tanimli = (ad) => fonk(ad) !== ''
const izinDizisi = `array[${IZIN_ADLARI.map((p) => `'${p.toLowerCase()}'`).join(', ')}]::text[]`

// Önceki migration'lar (her fonksiyonun/politikanın en son tanımı: sonraki dosya kazanır)
const oncekiler = readdirSync('supabase/migrations')
  .filter((d) => /^\d{3}_.*\.sql$/.test(d) && d < '013')
  .sort()
  .map((d) => readFileSync(`supabase/migrations/${d}`, 'utf8').replace(/--[^\n]*/g, '').toLowerCase().replace(/\s+/g, ' '))

// Önceki migration'larda sahipliğe bakan fonksiyon ve politikalar (en son tanım)
function sahipBagliOncekiler() {
  const fonksiyonlar = new Map() // ad -> gövde (en son)
  const politikalar = new Map() // ad -> metin (en son; drop edilince silinir)
  for (const metin of oncekiler) {
    for (const e of metin.matchAll(/create (?:or replace )?function public\.(\w+)\(/g)) {
      fonksiyonlar.set(e[1], fonk(e[1], metin.slice(e.index)))
    }
    for (const e of metin.matchAll(/drop policy if exists (\w+) on|create policy (\w+) on [^;]*;/g)) {
      if (e[1]) politikalar.delete(e[1])
      else politikalar.set(e[2], e[0])
    }
  }
  const sahipli = (m) => /owner_id = auth\.uid\(\)/.test(m)
  return {
    fonksiyonlar: [...fonksiyonlar].filter(([, g]) => sahipli(g)).map(([a]) => a).sort(),
    politikalar: [...politikalar].filter(([, g]) => sahipli(g)).map(([a]) => a).sort(),
  }
}

describe('013_roller.sql', () => {
  it('dosya var', () => expect(existsSync(yol)).toBe(true))

  it('yalnız ekleme: sütun/tablo silme, yeniden adlandırma yok; delete_server ve leave_server yeniden tanımlanmaz', () => {
    expect(sql).not.toMatch(/drop column|rename column|rename to|drop table|alter column|drop function/)
    expect(tanimli('delete_server')).toBe(false)
    expect(tanimli('leave_server')).toBe(false)
    expect(tanimli('create_server')).toBe(false)
  })

  it('roles: sütunlar, renk/izin/sıra kısıtları, tek @herkes, RLS (yalnız üyeler okur, yazma politikası yok)', () => {
    expect(sql).toContain('create table if not exists public.roles (')
    expect(sql).toContain('server_id uuid not null references public.servers(id) on delete cascade')
    expect(sql).toContain('check (char_length(name) between 1 and 30)')
    expect(sql).toContain(`color in (${ROL_RENK_ADLARI.map((r) => `'${r}'`).join(', ')})`)
    expect(sql).toContain(`check (permissions <@ ${izinDizisi})`)
    expect(sql).toContain('constraint roles_sira check ((is_default and position = 0) or (not is_default and position >= 1))')
    expect(sql).toContain('constraint roles_sunucu_id unique (server_id, id)')
    expect(sql).toContain('create unique index if not exists roles_tek_varsayilan on public.roles (server_id) where is_default;')
    expect(sql).toContain('alter table public.roles enable row level security;')
    expect(sql).toMatch(/create policy roles_select on public\.roles for select to authenticated using \(public\.is_member\(server_id\)\);/)
    expect(sql).not.toMatch(/create policy \w+ on public\.roles for (insert|update|delete|all)/)
  })

  it('member_roles: üyeliğe ve aynı sunucunun rolüne bileşik FK (cascade); profiles/auth.users FK yok (gömme belirsizliği olmasın)', () => {
    const t = sql.slice(sql.indexOf('create table if not exists public.member_roles'), sql.indexOf('create index if not exists member_roles_role_idx'))
    expect(t).toContain('primary key (server_id, user_id, role_id)')
    expect(t).toContain('foreign key (server_id, user_id) references public.server_members (server_id, user_id) on delete cascade')
    expect(t).toContain('foreign key (server_id, role_id) references public.roles (server_id, id) on delete cascade')
    expect(t).not.toMatch(/references (public\.profiles|auth\.users|public\.servers)/)
    expect(sql).toContain('alter table public.member_roles enable row level security;')
    expect(sql).toMatch(/create policy member_roles_select on public\.member_roles for select to authenticated using \(public\.is_member\(server_id\)\);/)
    expect(sql).not.toMatch(/create policy \w+ on public\.member_roles for (insert|update|delete|all)/)
  })

  it('@herkes: geriye dönük doldurma ve yeni sunucuda tetikleyici', () => {
    expect(sql).toMatch(/insert into public\.roles \(server_id, name, color, position, permissions, is_default\) select s\.id, '@herkes', null, 0, '\{\}', true from public\.servers s where not exists/)
    const f = fonk('varsayilan_rol_kur')
    expect(f).toContain("values (new.id, '@herkes', null, 0, '{}', true)")
    expect(sql).toContain('create trigger servers_varsayilan_rol after insert on public.servers for each row execute function public.varsayilan_rol_kur();')
    // Doldurma, rol olay tetikleyicisinden ÖNCE (her sunucu için yayın gitmesin)
    expect(sql.indexOf("select s.id, '@herkes'")).toBeLessThan(sql.indexOf('create trigger roles_degisti'))
  })

  it('izin listesi istemciyle aynı (izin_adlari)', () => {
    expect(fonk('izin_adlari')).toContain(`select ${izinDizisi};`)
    expect(fonk('izin_adlari')).toContain('immutable')
  })

  it('has_permission: tek merkez; sahip her izne sahip, null dönmez, yabancı sunucuyu soramaz', () => {
    const f = fonk('has_permission')
    expect(f).toContain('returns boolean')
    expect(f).toContain('security definer')
    expect(f).toContain('set search_path = public')
    expect(f).toContain('if sid is null or uid is null or perm is null or auth.uid() is null then return false;')
    expect(f).toContain('if uid <> auth.uid() and not public.is_member(sid) then return false;')
    expect(f).toContain('s.owner_id = uid) then return true;')
    expect(f).toContain('perm = any (r.permissions)')
    expect(f).toContain('r.is_default or exists (select 1 from public.member_roles mr')
    // Sonuç her yolda true/false (exists ya da sabit)
    expect(f).not.toMatch(/return null/)
    expect(sql).toContain('revoke all on function public.has_permission(uuid, uuid, text) from public, anon;')
    expect(sql).toContain('grant execute on function public.has_permission(uuid, uuid, text) to authenticated;')
  })

  it('iç yardımcılar istemciye kapalı', () => {
    for (const imza of ['kisi_izinleri(uuid, uuid)', 'uye_ust_sira(uuid, uuid)', 'rol_rengi_gecerli(text)', 'izin_dizisi(text[])', 'rol_yoneticisi(uuid)', 'rolleri_sirala(uuid)', 'rol_kilidi(uuid)']) {
      expect(sql, imza).toContain(`revoke all on function public.${imza} from public, anon, authenticated;`)
      expect(sql, imza).not.toContain(`grant execute on function public.${imza}`)
    }
    expect(fonk('uye_ust_sira')).toContain(`then ${EN_UST_SIRA}`)
  })

  it('bugün sahibe bağlı HER fonksiyon/politika 013te has_permission ile yeniden tanımlanır (delete_server, leave_server hariç)', () => {
    const { fonksiyonlar, politikalar } = sahipBagliOncekiler()
    // Tarama gerçekten bir şey buluyor (test boşa geçmesin)
    expect(fonksiyonlar).toEqual(['can_pin', 'delete_channel', 'delete_message', 'delete_server', 'ek_silinebilir', 'leave_server', 'rename_channel', 'rename_server'])
    expect(politikalar).toEqual(['channels_insert'])
    const izin = {
      can_pin: 'manage_messages', delete_channel: 'manage_channels', delete_message: 'manage_messages',
      ek_silinebilir: 'manage_messages', rename_channel: 'manage_channels', rename_server: 'manage_server',
    }
    for (const [ad, perm] of Object.entries(izin)) {
      const f = fonk(ad)
      expect(f, ad).not.toBe('')
      expect(f, ad).toContain(`public.has_permission(`)
      expect(f, ad).toContain(`'${perm}')`)
      expect(f, ad).not.toContain('owner_id')
    }
    expect(sql).toContain("create policy channels_insert on public.channels for insert to authenticated with check (public.has_permission(server_id, auth.uid(), 'manage_channels'));")
    expect(sql.indexOf('drop policy if exists channels_insert on public.channels;')).toBeLessThan(sql.indexOf('create policy channels_insert'))
    // 013'te sahipliği doğrudan soran tek yer has_permission ve iç yardımcılar
    const sahipSoranlar = [...sql.matchAll(/create (?:or replace )?function public\.(\w+)\(/g)].map((e) => e[1]).filter((a) => /owner_id/.test(fonk(a)))
    expect(sahipSoranlar.sort()).toEqual(['has_permission', 'kisi_izinleri', 'uye_ust_sira'])
  })

  it('eski RPC davranışları korunur (yazar kendi mesajını siler, son yazılı kanal, kilit, uzunluk)', () => {
    expect(fonk('delete_message')).toContain('if m.author_id <> auth.uid() and not public.has_permission(sid, auth.uid(), \'manage_messages\') then')
    expect(fonk('delete_channel')).toContain('sunucuda en az bir yazılı kanal kalmalı.')
    expect(fonk('delete_channel')).toContain('for update')
    expect(fonk('rename_channel')).toContain('not between 1 and 30')
    expect(fonk('rename_server')).toContain('not between 1 and 40')
    expect(fonk('ek_silinebilir')).toContain('not exists (select 1 from public.attachments a where a.path = yol)')
    expect(fonk('can_pin')).toContain('public.is_member(c.server_id)')
  })

  it('rol RPCleri: kilit, MANAGE_ROLES, hiyerarşi, izin alt kümesi, @herkes korumaları', () => {
    const c = fonk('create_role')
    expect(c).toContain('perform public.rol_kilidi(sid);')
    expect(c).toContain('perform public.rol_yoneticisi(sid);')
    expect(c).toContain("raise exception 'role_name'")
    expect(c).toContain("raise exception 'role_color'")
    expect(c).toContain('if not (dizi <@ public.kisi_izinleri(sid, ben)) then raise exception \'permission_not_held\'')
    expect(c).toContain(`>= ${ROL_SINIRI} then raise exception 'role_limit'`)
    expect(c).toContain('values (sid, yeni_ad, renk, 1, dizi)')

    const u = fonk('update_role')
    expect(u).toContain('if not r.is_default and r.position >= ust then raise exception \'role_hierarchy\'')
    expect(u).toContain('except select unnest(r.permissions)')
    expect(u).toContain("if not (fark <@ public.kisi_izinleri(r.server_id, ben)) then raise exception 'permission_not_held'")
    expect(u).toContain('if r.is_default then update public.roles x set permissions = dizi where x.id = rid; return;')

    const d = fonk('delete_role')
    expect(d).toContain("if r.is_default then raise exception 'default_role'")
    expect(d).toContain("if r.position >= ust then raise exception 'role_hierarchy'")
    expect(d).toContain('perform public.rolleri_sirala(r.server_id);')

    const m = fonk('move_role')
    expect(m).toContain("if r.is_default then raise exception 'default_role'")
    expect(m).toContain("if r.position >= ust or h >= ust then raise exception 'role_hierarchy'")
    expect(m).toContain('h := greatest(1, least(n, coalesce(hedef, r.position)));')
    // yetki denetimi sıralamadan (yazmadan) önce
    expect(m.indexOf('perform public.rol_yoneticisi')).toBeLessThan(m.indexOf('perform public.rolleri_sirala'))

    const s = fonk('set_member_role')
    expect(s).toContain("if r.is_default then raise exception 'default_role'")
    expect(s).toContain("if r.position >= ust then raise exception 'role_hierarchy'")
    expect(s).toContain("if uid <> ben and public.uye_ust_sira(sid, uid) >= ust then raise exception 'role_hierarchy'")
    expect(s).toContain("if not (r.permissions <@ public.kisi_izinleri(sid, ben)) then raise exception 'permission_not_held'")
    expect(s).toContain('where x.id = rid and x.server_id = sid')

    const y = fonk('rol_yoneticisi')
    expect(y).toContain("not public.has_permission(sid, auth.uid(), 'manage_roles') then raise exception 'not_allowed'")
    expect(fonk('izin_dizisi')).toContain("raise exception 'bad_permission'")
  })

  it('kick_member: KICK_MEMBERS, kendini/üsttekini çıkaramaz, ses ve okundu kayıtları silinir, önce olay', () => {
    const f = fonk('kick_member')
    expect(f).toContain("not public.has_permission(sid, ben, 'kick_members') then raise exception 'not_allowed'")
    expect(f).toContain('if uid = ben')
    expect(f).toContain("if public.uye_ust_sira(sid, uid) >= public.uye_ust_sira(sid, ben) then raise exception 'role_hierarchy'")
    expect(f).toContain('delete from public.voice_states where user_id = uid and server_id = sid;')
    expect(f).toContain('delete from public.server_members where server_id = sid and user_id = uid;')
    expect(f.indexOf("'roller'")).toBeLessThan(f.indexOf('delete from public.server_members'))
  })

  it('regenerate_invite ve move_channel', () => {
    const r = fonk('regenerate_invite')
    expect(r).toContain('returns text')
    expect(r).toContain("public.has_permission(sid, auth.uid(), 'manage_server')")
    expect(r).toContain('public.gen_invite_code()')
    expect(r).toContain('exception when unique_violation')
    const m = fonk('move_channel')
    expect(m).toContain('yon not in (-1, 1)')
    expect(m).toContain("public.has_permission(sid, auth.uid(), 'manage_channels')")
    expect(m).toContain('c.kind = tur')
    expect(m).toContain('for update')
  })

  it('her RPC: security definer, search_path; anon kapalı, authenticated açık', () => {
    const rpcler = {
      'create_role(uuid, text, text, text[])': 'create_role', 'update_role(uuid, text, text, text[], boolean)': 'update_role',
      'delete_role(uuid)': 'delete_role', 'move_role(uuid, int)': 'move_role', 'set_member_role(uuid, uuid, uuid, boolean)': 'set_member_role',
      'kick_member(uuid, uuid)': 'kick_member', 'regenerate_invite(uuid)': 'regenerate_invite', 'move_channel(uuid, int)': 'move_channel',
      'delete_message(bigint)': 'delete_message', 'rename_server(uuid, text)': 'rename_server', 'delete_channel(uuid)': 'delete_channel',
      'rename_channel(uuid, text)': 'rename_channel', 'can_pin(uuid)': 'can_pin', 'ek_silinebilir(text)': 'ek_silinebilir',
      'mentions_everyone(text)': 'mentions_everyone', 'unread_counts()': 'unread_counts',
    }
    for (const [imza, ad] of Object.entries(rpcler)) {
      const f = fonk(ad)
      expect(f, ad).toContain('security definer')
      expect(f, ad).toContain('set search_path = public')
      expect(sql, imza).toContain(`revoke all on function public.${imza} from public, anon;`)
      expect(sql, imza).toContain(`grant execute on function public.${imza} to authenticated;`)
    }
    // Her fonksiyon security definer + search_path
    for (const e of sql.matchAll(/create (?:or replace )?function public\.(\w+)\(/g)) {
      expect(fonk(e[1]), e[1]).toContain('security definer')
      expect(fonk(e[1]), e[1]).toContain('set search_path = public')
    }
  })

  it('@herkes: mentions_everyone kelime sınırı (007 ile aynı) ve unread_counts izinle sayar, sütunlar aynı', () => {
    expect(ham).toContain("'(^|[^[:alnum:]_])@(herkes|everyone)($|[^[:alnum:]_])'")
    expect(fonk('mentions_everyone')).toContain('immutable')
    const f = fonk('unread_counts')
    expect(f).toContain('returns table (channel_id uuid, server_id uuid, count int, mentions int)')
    expect(f).toContain('public.mentions_user(y.content, ben.username)')
    expect(f).toContain("public.mentions_everyone(y.content) and public.has_permission(c.server_id, y.author_id, 'mention_everyone')")
    expect(sql).not.toContain('drop function if exists public.unread_counts')
  })

  it('canlı: roles ve member_roles değişince "roller" olayı server: konusuna; sunucu silinirken ve cascade atamada olay yok', () => {
    const f = fonk('rol_olayi_gonder')
    expect(f).toContain("'roller', 'server:' || sid::text, true")
    expect(f).toContain('if not exists (select 1 from public.servers s where s.id = sid) then return null;')
    expect(f).toContain("tg_table_name = 'member_roles' and tg_op = 'delete' and not exists (select 1 from public.roles r")
    expect(f).toContain('exception when others then null;')
    expect(sql).toContain('create trigger roles_degisti after insert or update or delete on public.roles for each row execute function public.rol_olayi_gonder();')
    expect(sql).toContain('create trigger member_roles_degisti after insert or delete on public.member_roles for each row execute function public.rol_olayi_gonder();')
    // istemci gönderemez: realtime.messages'a yeni politika yok
    expect(sql).not.toMatch(/on realtime\.messages/)
  })
})
