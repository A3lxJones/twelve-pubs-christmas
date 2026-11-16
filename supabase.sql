-- Run this once in Supabase SQL Editor. It replaces the permissive room policies
-- with private RPCs: the organiser key can manage pairings, the invite key can join/read.
create extension if not exists pgcrypto;

create table if not exists public.pub_rooms (
  code text primary key check (code = upper(code)),
  room_name text,
  invite_key_hash text not null,
  owner_key_hash text not null,
  pairings jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.pub_rooms
  add column if not exists room_name text;

create table if not exists public.pub_participants (
  id uuid primary key default gen_random_uuid(),
  room_code text not null references public.pub_rooms(code) on delete cascade,
  name text not null,
  updated_at timestamptz not null default now(),
  unique(room_code, name)
);

alter table public.pub_rooms enable row level security;
alter table public.pub_participants enable row level security;
revoke all on public.pub_rooms from anon, authenticated;
revoke all on public.pub_participants from anon, authenticated;
-- Remove both the original four-argument RPC and any partially-created
-- five-argument version before recreating the named-room version.
drop function if exists public.create_pub_room(text, text, text, text);
drop function if exists public.create_pub_room(text, text, text, text, text);

create or replace function public.create_pub_room(
  room_code text, room_name text, invite_key text, owner_key text, attendee_name text
) returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if length(trim(room_code)) < 4 or length(trim(room_name)) < 1 or length(trim(invite_key)) < 6 or length(trim(owner_key)) < 6 or length(trim(attendee_name)) < 1 then
    raise exception 'Room code, keys, and name do not meet minimum length';
  end if;
  insert into pub_rooms(code, room_name, invite_key_hash, owner_key_hash)
  values (upper(trim(room_code)), trim(room_name), extensions.crypt(invite_key, extensions.gen_salt('bf')), extensions.crypt(owner_key, extensions.gen_salt('bf')));
  insert into pub_participants(room_code, name) values (upper(trim(room_code)), trim(attendee_name));
  return jsonb_build_object('code', upper(trim(room_code)), 'room_name', trim(room_name), 'owner', true);
exception when unique_violation then
  raise exception 'Room code already exists';
end;
$$;

create or replace function public.join_pub_room(
  room_code text, invite_key text, attendee_name text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare room pub_rooms%rowtype;
begin
  select * into room from pub_rooms where code = upper(trim(room_code));
  if room.code is null or room.invite_key_hash <> extensions.crypt(invite_key, room.invite_key_hash) then raise exception 'Invalid room or invite key'; end if;
  insert into pub_participants(room_code, name) values (room.code, trim(attendee_name))
    on conflict (room_code, name) do update set updated_at = now();
  return jsonb_build_object('code', room.code, 'pairings', room.pairings);
end;
$$;

drop function if exists public.get_pub_room(text, text);

create or replace function public.get_pub_room(
  room_code text, invite_key text, attendee_name text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare room pub_rooms%rowtype; pairing jsonb;
begin
  select * into room from pub_rooms where code = upper(trim(room_code));
  if room.code is null or room.invite_key_hash <> extensions.crypt(invite_key, room.invite_key_hash) then raise exception 'Invalid room or invite key'; end if;
  pairing := room.pairings -> trim(attendee_name);
  return jsonb_build_object(
    'room_name', room.room_name,
    'pairings', case when pairing is null then '{}'::jsonb else jsonb_build_object(trim(attendee_name), pairing) end
  );
end;
$$;

create or replace function public.update_pub_pairings(
  room_code text, owner_key text, new_pairings jsonb
) returns jsonb language plpgsql security definer set search_path = public as $$
declare room pub_rooms%rowtype;
begin
  select * into room from pub_rooms where code = upper(trim(room_code));
  if room.code is null or room.owner_key_hash <> extensions.crypt(owner_key, room.owner_key_hash) then raise exception 'Invalid organiser key'; end if;
  update pub_rooms set pairings = new_pairings, updated_at = now() where code = room.code;
  return new_pairings;
end;
$$;

grant execute on function public.create_pub_room(text, text, text, text, text) to anon, authenticated;
grant execute on function public.join_pub_room(text, text, text) to anon, authenticated;
grant execute on function public.get_pub_room(text, text, text) to anon, authenticated;
grant execute on function public.update_pub_pairings(text, text, jsonb) to anon, authenticated;

-- Ask PostgREST to refresh its RPC schema immediately.
notify pgrst, 'reload schema';


-- Shared room announcements and attendee safety statuses.
create table if not exists public.pub_announcements (
  id bigint generated always as identity primary key,
  room_code text not null references public.pub_rooms(code) on delete cascade,
  message text not null check (char_length(trim(message)) between 1 and 500),
  created_at timestamptz not null default now()
);
create index if not exists pub_announcements_room_created_idx on public.pub_announcements(room_code, created_at desc);
alter table public.pub_announcements enable row level security;
revoke all on public.pub_announcements from anon, authenticated;

create table if not exists public.pub_statuses (
  room_code text not null references public.pub_rooms(code) on delete cascade,
  attendee_name text not null,
  status text not null check (char_length(trim(status)) between 1 and 120),
  updated_at timestamptz not null default now(),
  primary key (room_code, attendee_name)
);
alter table public.pub_statuses enable row level security;
revoke all on public.pub_statuses from anon, authenticated;

create or replace function public.post_pub_announcement(p_room_code text, p_owner_key text, p_message text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare room public.pub_rooms%rowtype; clean_message text := trim(p_message);
begin
  select * into room from public.pub_rooms where code = upper(trim(p_room_code));
  if room.code is null or room.owner_key_hash <> extensions.crypt(trim(p_owner_key), room.owner_key_hash) then raise exception 'Invalid organiser key'; end if;
  if char_length(clean_message) < 1 or char_length(clean_message) > 500 then raise exception 'Announcement must be between 1 and 500 characters'; end if;
  insert into public.pub_announcements(room_code, message) values (room.code, clean_message);
  return jsonb_build_object('message', clean_message);
end; $$;

create or replace function public.get_pub_announcements(p_room_code text, p_invite_key text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare room public.pub_rooms%rowtype; announcements jsonb;
begin
  select * into room from public.pub_rooms where code = upper(trim(p_room_code));
  if room.code is null or room.invite_key_hash <> extensions.crypt(trim(p_invite_key), room.invite_key_hash) then raise exception 'Invalid room or invite key'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('message', a.message, 'created_at', a.created_at) order by a.created_at desc), '[]'::jsonb) into announcements from (select message, created_at from public.pub_announcements where room_code = room.code order by created_at desc limit 20) a;
  return announcements;
end; $$;

create or replace function public.update_pub_status(p_room_code text, p_invite_key text, p_attendee_name text, p_status text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare room public.pub_rooms%rowtype; clean_name text := trim(p_attendee_name); clean_status text := trim(p_status);
begin
  select * into room from public.pub_rooms where code = upper(trim(p_room_code));
  if room.code is null or room.invite_key_hash <> extensions.crypt(trim(p_invite_key), room.invite_key_hash) then raise exception 'Invalid room or invite key'; end if;
  if char_length(clean_name) < 1 or char_length(clean_status) < 1 or char_length(clean_status) > 120 then raise exception 'Status is invalid'; end if;
  insert into public.pub_statuses(room_code, attendee_name, status) values (room.code, clean_name, clean_status) on conflict (room_code, attendee_name) do update set status = excluded.status, updated_at = now();
  return jsonb_build_object('status', clean_status);
end; $$;

grant execute on function public.post_pub_announcement(text, text, text) to anon, authenticated;
grant execute on function public.get_pub_announcements(text, text) to anon, authenticated;
grant execute on function public.update_pub_status(text, text, text, text) to anon, authenticated;
