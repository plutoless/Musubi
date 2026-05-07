alter table consent_requests add column if not exists kind text;
alter table consent_requests add column if not exists workspace_id text;
alter table consent_requests add column if not exists code_challenge text;
alter table consent_requests add column if not exists code_challenge_method text;
alter table consent_requests add column if not exists app_public_key text;
alter table consent_requests add column if not exists selected_device_id text references devices(id);
alter table consent_requests add column if not exists authorization_code_hash text;
alter table consent_requests add column if not exists authorization_code_used_at timestamptz;

create table if not exists app_session_tokens (
  id text primary key,
  token_hash text not null,
  app_id text not null references apps(id),
  user_id text references users(id),
  workspace_id text not null,
  app_key_id text references app_keys(id),
  status text not null default 'active',
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  last_used_at timestamptz,
  revoked_at timestamptz,
  revoked_by text
);

create index if not exists idx_app_session_tokens_hash_active
  on app_session_tokens(token_hash)
  where status = 'active';

create table if not exists admin_sessions (
  id text primary key,
  token_hash text not null,
  user_id text not null,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  last_used_at timestamptz,
  revoked_at timestamptz
);

create index if not exists idx_admin_sessions_hash_active
  on admin_sessions(token_hash)
  where status = 'active';
