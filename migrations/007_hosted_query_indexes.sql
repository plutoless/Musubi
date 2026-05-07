alter table messages add column if not exists crypto jsonb;

create index if not exists idx_messages_created_at_desc
  on messages (created_at desc);

create index if not exists idx_apps_created_at_desc
  on apps (created_at desc, id desc);

create index if not exists idx_apps_workspace_created_at
  on apps (workspace_id, created_at desc, id desc);

create index if not exists idx_devices_created_at_desc
  on devices (created_at desc, id desc);

create index if not exists idx_devices_workspace_created_at
  on devices (workspace_id, created_at desc, id desc);

create index if not exists idx_developers_created_at_desc
  on developer_accounts (created_at desc, id desc);

create index if not exists idx_publishers_created_at_desc
  on publisher_profiles (created_at desc, id desc);

create index if not exists idx_app_api_keys_app_created_at
  on app_api_keys (app_id, created_at asc, id asc);

create index if not exists idx_messages_app_created_at
  on messages (app_id, created_at desc);

create index if not exists idx_messages_device_created_at
  on messages (device_id, created_at desc);

create index if not exists idx_messages_status_created_at
  on messages (status, created_at desc);

create index if not exists idx_messages_channel_created_at
  on messages (channel, created_at desc);

create index if not exists idx_audit_events_created_at_desc
  on audit_events (created_at desc);

create index if not exists idx_audit_events_message_created_at
  on audit_events (message_id, created_at desc);

create index if not exists idx_audit_events_app_created_at
  on audit_events (app_id, created_at desc);

create index if not exists idx_audit_events_device_created_at
  on audit_events (device_id, created_at desc);

create index if not exists idx_capabilities_reported_at_desc
  on device_plugin_capabilities (reported_at desc);

create index if not exists idx_capabilities_device_reported_at
  on device_plugin_capabilities (device_id, reported_at desc);

create index if not exists idx_grants_app_active_created_at
  on app_device_channel_grants (app_id, created_at desc)
  where revoked_at is null;

create index if not exists idx_grants_created_at_desc
  on app_device_channel_grants (created_at desc, id desc);

create index if not exists idx_grants_workspace_created_at
  on app_device_channel_grants (workspace_id, created_at desc, id desc);

create index if not exists idx_grants_device_active_created_at
  on app_device_channel_grants (device_id, created_at desc)
  where revoked_at is null;

create index if not exists idx_grants_app_device_active_created_at
  on app_device_channel_grants (app_id, device_id, created_at desc)
  where revoked_at is null;

create index if not exists idx_message_status_events_message_created_at
  on message_status_events (message_id, created_at asc);
