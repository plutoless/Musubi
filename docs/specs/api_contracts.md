# M1 API Contracts

## Register Device

`POST /v1/devices/register`

Creates a device and active device public key. Hosted mode requires user auth.

## Connect Device WebSocket

`GET /v1/devices/{device_id}/connect`

The CLI proves possession of the active device private key with a signed timestamp or challenge.

## Report Plugin Capabilities

`POST /v1/devices/{device_id}/capabilities`

Reports plugin manifests, channels, and permissions. The server stores capability metadata only.

## Create App

`POST /v1/apps`

Creates a first-party or user-owned app and stores an active app public key.

## Create Grant

`POST /v1/grants`

Grants an app access to a device and allowed channel set. Queueing defaults to false.

## Send Message

`POST /v1/messages`

Creates a message, checks app/device/channel grant, persists status/audit, and routes the opaque encrypted envelope if the device is online.

## Get Message Status

`GET /v1/messages/{message_id}`

Returns status and timestamps without plaintext payload.

## Cancel Message

`POST /v1/messages/{message_id}/cancel`

Marks cancellation requested and routes a cancel control envelope to the device when online.
