# M1 Local Policy Spec

M1 local policy is YAML and deny-by-default.

Default location:

```text
~/.musubi/policy.yaml
```

## Required Behavior

The CLI must check:

1. App is known or allowed.
2. Plugin exists and is enabled.
3. Channel is allowed for that app/plugin.
4. Plugin permissions do not exceed local policy.
5. Request duration is within policy.
6. Workspace path hints are inside allowed directories when present.
7. Local confirmation is not required, or the user approved it.

## Minimal Shape

```yaml
version: m1
defaults:
  require_local_confirm: true
  max_task_duration_seconds: 3600
apps:
  app_hermes:
    plugins:
      hermes:
        allow:
          - hermes.task.create
plugins:
  hermes:
    enabled: true
    permissions:
      - process.spawn
```

## Denials

Local denials should return encrypted/local-safe error events. Server audit may record that local policy denied the message, but not the decrypted request body.
