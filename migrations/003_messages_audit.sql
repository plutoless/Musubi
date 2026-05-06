create table if not exists messages (
  id text primary key,
  workspace_id text not null references workspaces(id),
  app_id text not null references apps(id),
  device_id text not null references devices(id),
  channel text not null,
  status text not null,
  visible_metadata jsonb,
  ciphertext text,
  artifact_ref text,
  ttl_seconds int not null default 300,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz,
  error_code text,
  error_message text
);

create table if not exists audit_events (
  id text primary key,
  workspace_id text not null references workspaces(id),
  actor_type text not null,
  actor_id text,
  event_type text not null,
  app_id text references apps(id),
  device_id text references devices(id),
  message_id text,
  channel text,
  metadata jsonb,
  created_at timestamptz not null default now()
);
