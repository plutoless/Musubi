alter table users add column if not exists password_hash text;
alter table users add column if not exists password_salt text;
alter table users add column if not exists updated_at timestamptz;

create table if not exists user_sessions (
  id text primary key,
  token_hash text not null,
  user_id text not null references users(id),
  workspace_id text not null references workspaces(id),
  status text not null default 'active',
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  last_used_at timestamptz,
  revoked_at timestamptz
);

create index if not exists idx_user_sessions_hash_active
  on user_sessions(token_hash)
  where status = 'active';

create table if not exists device_registration_tokens (
  id text primary key,
  token_hash text not null,
  user_id text not null references users(id),
  workspace_id text not null references workspaces(id),
  status text not null default 'active',
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz,
  used_device_id text references devices(id),
  revoked_at timestamptz
);

create index if not exists idx_device_registration_tokens_hash_active
  on device_registration_tokens(token_hash)
  where status = 'active';
