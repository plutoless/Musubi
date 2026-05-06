create table if not exists device_plugin_capabilities (
  id text primary key,
  workspace_id text not null references workspaces(id),
  device_id text not null references devices(id),
  plugin_name text not null,
  plugin_version text not null,
  channels text[] not null,
  permissions text[] not null,
  manifest jsonb,
  reported_at timestamptz not null default now()
);
