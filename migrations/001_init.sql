create table if not exists workspaces (
  id text primary key,
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists users (
  id text primary key,
  email text unique,
  name text,
  created_at timestamptz not null default now()
);

create table if not exists devices (
  id text primary key,
  workspace_id text not null references workspaces(id),
  owner_user_id text references users(id),
  name text not null,
  platform text,
  cli_version text,
  status text not null default 'offline',
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

create table if not exists apps (
  id text primary key,
  workspace_id text not null references workspaces(id),
  name text not null,
  type text not null default 'first_party',
  status text not null default 'active',
  created_by text references users(id),
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

create table if not exists app_device_channel_grants (
  id text primary key,
  workspace_id text not null references workspaces(id),
  app_id text not null references apps(id),
  device_id text not null references devices(id),
  allowed_channels text[] not null,
  queueing_allowed boolean not null default false,
  created_by text references users(id),
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);
