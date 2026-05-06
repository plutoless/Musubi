# Musubi M2 Control Plane

M2 turns Musubi's trust model into visible product behavior:

```text
Cloud policy decides who may ask.
Local policy decides what may run.
Encryption ensures the server cannot read.
Plugins define what the machine can do.
```

The implementation is intentionally minimal and local-first. The Bun relay serves a static control plane at `/control-plane` and exposes the M2 read/revoke/grant APIs under `/v1`.

The hosted data model extensions are captured in `migrations/005_control_plane_m2.sql`.

## Route Map

```text
/control-plane
  Home
  Devices
    /v1/devices
    /v1/devices/:device_id
    /v1/devices/:device_id/revoke
  Apps
    /v1/apps
    /v1/apps/:app_id
    /v1/apps/:app_id/revoke
  Grants
    /v1/grants
    /v1/grants/:grant_id
    /v1/grants/:grant_id/revoke
  Messages
    /v1/messages
    /v1/messages/:message_id
  Audit
    /v1/audit-events
```

## Wireframes

### Home

```text
Musubi Control Plane

[Connected devices] [Online now] [Apps with access] [Messages]

Setup
  go run ./cmd/musubi device register --server <server> --home .musubi/m2

Recent Messages
  Time | App | Device | Channel | Status | Message ID
```

### Devices

```text
Devices
  Device | Status | Platform | CLI Version | Plugins | Authorized Apps | Last Seen | Actions

Device Detail
  Overview
  Capabilities
  Authorized Apps
  Recent Messages
  Audit
  Local Policy
  Danger Zone: Revoke device
```

### Apps

```text
Apps
  App | Type | Status | Authorized Devices | Allowed Channels | Created At | Actions

App Detail
  Overview
  Keys
  Authorized Devices
  Messages
  Audit
  Danger Zone: Revoke app
```

### Grant Flow

```text
Select app
Select device
Select plugin
Select channels
Queueing toggle
Review security summary
Create grant
Edit existing grant channels or queueing
Revoke grant
```

The UI builds channel checkboxes from reported device plugin capabilities, so users do not need to manually type channel names.

### Message Detail

```text
Summary
Timeline: created -> validated -> delivered -> received -> processing -> completed/failed
Crypto metadata
Audit events
```

No plaintext payload is shown.

## Security Copy

The M2 UI uses these phrases:

```text
Apps can ask. Your machine decides.
Musubi routes encrypted messages but cannot read task contents.
Cloud grants allow an app to ask. Local policy on this machine still decides whether the request can run.
This grant allows an app to request specific plugin channels, not access the whole machine.
Payload encrypted end-to-end. Musubi server cannot display task contents.
```

The UI avoids phrases such as remote control, full access, tunnel, or shell UX.

## Verification

Run:

```bash
bun run verify:m2-control-plane
```

The verifier proves:

- `/control-plane` serves the control-plane app.
- Devices/apps/messages/audit read APIs return display data without plaintext payloads.
- Device detail shows reported plugin capabilities and local policy placeholder copy.
- Grant creation uses reported Hermes channels.
- Grant edit updates channel selection and queueing.
- A Hermes task completes through the existing M1 encrypted flow.
- Message detail exposes status timeline and crypto metadata without plaintext payload.
- Audit excludes plaintext payload.
- Revoked grant blocks future sends.
- Revoked app blocks future sends.
- Revoked device blocks future sends and future device connection.
- M2 control-plane docs and migration artifacts are present.
