alter table devices add column if not exists display_name text;
alter table devices add column if not exists description text;
alter table devices add column if not exists last_capability_report_at timestamptz;
alter table devices add column if not exists revoked_by text;

alter table apps add column if not exists description text;
alter table apps add column if not exists disabled_at timestamptz;
alter table apps add column if not exists disabled_by text;
alter table apps add column if not exists revoked_by text;

alter table app_device_channel_grants add column if not exists name text;
alter table app_device_channel_grants add column if not exists description text;
alter table app_device_channel_grants add column if not exists revoked_by text;
alter table app_device_channel_grants add column if not exists updated_at timestamptz;

create table if not exists message_status_events (
  id text primary key,
  message_id text not null references messages(id),
  workspace_id text not null references workspaces(id),
  status text not null,
  stage text,
  error_code text,
  error_message text,
  metadata jsonb,
  created_at timestamptz not null default now()
);

create table if not exists local_policy_reports (
  id text primary key,
  workspace_id text not null references workspaces(id),
  device_id text not null references devices(id),
  policy_version text,
  summary jsonb not null,
  reported_at timestamptz not null default now()
);
