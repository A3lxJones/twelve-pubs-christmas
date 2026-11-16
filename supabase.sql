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
  values (upper(trim(room_code)), trim(room_name), crypt(invite_key, gen_salt('bf')), crypt(owner_key, gen_salt('bf')));
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
  if room.code is null or room.invite_key_hash <> crypt(invite_key, room.invite_key_hash) then raise exception 'Invalid room or invite key'; end if;
  insert into pub_participants(room_code, name) values (room.code, trim(attendee_name))
    on conflict (room_code, name) do update set updated_at = now();
  return jsonb_build_object('code', room.code, 'pairings', room.pairings);
end;
$$;

create or replace function public.get_pub_room(
  room_code text, invite_key text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare room pub_rooms%rowtype; people jsonb;
begin
  select * into room from pub_rooms where code = upper(trim(room_code));
  if room.code is null or room.invite_key_hash <> crypt(invite_key, room.invite_key_hash) then raise exception 'Invalid room or invite key'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('name', name) order by name), '[]'::jsonb) into people from pub_participants where pub_participants.room_code = room.code;
  return jsonb_build_object('room_name', room.room_name, 'pairings', room.pairings, 'participants', people);
end;
$$;

create or replace function public.update_pub_pairings(
  room_code text, owner_key text, new_pairings jsonb
) returns jsonb language plpgsql security definer set search_path = public as $$
declare room pub_rooms%rowtype;
begin
  select * into room from pub_rooms where code = upper(trim(room_code));
  if room.code is null or room.owner_key_hash <> crypt(owner_key, room.owner_key_hash) then raise exception 'Invalid organiser key'; end if;
  update pub_rooms set pairings = new_pairings, updated_at = now() where code = room.code;
  return new_pairings;
end;
$$;

grant execute on function public.create_pub_room(text, text, text, text, text) to anon, authenticated;
grant execute on function public.join_pub_room(text, text, text) to anon, authenticated;
grant execute on function public.get_pub_room(text, text) to anon, authenticated;
grant execute on function public.update_pub_pairings(text, text, jsonb) to anon, authenticated;

-- Ask PostgREST to refresh its RPC schema immediately.
notify pgrst, 'reload schema';
