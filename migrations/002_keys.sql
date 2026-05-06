create table if not exists device_keys (
  id text primary key,
  device_id text not null references devices(id),
  public_key text not null,
  auth_public_key text,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  retired_at timestamptz,
  revoked_at timestamptz
);

create table if not exists app_keys (
  id text primary key,
  app_id text not null references apps(id),
  public_key text not null,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  retired_at timestamptz,
  revoked_at timestamptz
);
