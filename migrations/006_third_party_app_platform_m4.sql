create table if not exists developer_accounts (
  id text primary key,
  owner_user_id text references users(id),
  name text not null,
  email text,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  verified_at timestamptz,
  suspended_at timestamptz
);

create table if not exists publisher_profiles (
  id text primary key,
  developer_id text not null references developer_accounts(id),
  display_name text not null,
  website text,
  support_email text,
  privacy_policy_url text,
  terms_url text,
  logo_url text,
  verification_status text not null default 'unverified',
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

alter table apps add column if not exists publisher_id text references publisher_profiles(id);
alter table apps add column if not exists website text;
alter table apps add column if not exists privacy_policy_url text;
alter table apps add column if not exists terms_url text;
alter table apps add column if not exists trust_status text not null default 'unverified';
alter table apps add column if not exists review_status text not null default 'not_submitted';
alter table apps add column if not exists updated_at timestamptz;

create table if not exists app_api_keys (
  id text primary key,
  app_id text not null references apps(id),
  name text not null,
  prefix text not null,
  key_hash text not null,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz,
  revoked_by text
);

create table if not exists app_permission_declarations (
  id text primary key,
  app_id text not null references apps(id),
  plugin_name text not null,
  channels text[] not null,
  reason text,
  queueing_requested boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

create table if not exists consent_requests (
  id text primary key,
  app_id text not null references apps(id),
  user_id text references users(id),
  state text,
  redirect_uri text,
  requested_capabilities jsonb not null default '[]'::jsonb,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  expires_at timestamptz,
  grant_id text references app_device_channel_grants(id)
);

create table if not exists consent_request_events (
  id text primary key,
  consent_request_id text not null references consent_requests(id),
  event_type text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists app_abuse_reports (
  id text primary key,
  app_id text not null references apps(id),
  reporter_user_id text references users(id),
  reason text not null,
  description text,
  status text not null default 'open',
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

alter table app_device_channel_grants add column if not exists created_from_consent_request_id text references consent_requests(id);
