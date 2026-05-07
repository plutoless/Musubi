# M4.5 Plugin Registry Trust

M4.5 adds a local registry trust proof for plugin installation and reporting. The implementation is intentionally compact: registry metadata is served by the relay, the CLI verifies package metadata before writing an install record, and devices report trust metadata back to the control plane.

## Install Flow

```sh
go run ./cmd/musubi plugin install codex \
  --server http://127.0.0.1:8787 \
  --home .musubi/m4 \
  --version latest \
  --yes
```

The CLI resolves `GET /v1/plugin-registry/resolve`, reads `GET /v1/workspace/plugin-policy`, verifies the package digest, parses the registry Ed25519 public key, verifies the signature over the signed payload, and blocks unsigned or policy-denied plugins by default.

## Trust Policy

`GET /v1/workspace/plugin-policy` returns the local workspace install gates:

- `require_signature`
- `allowed_trust_levels`
- `allowed_plugins`
- `blocked_plugins`
- `require_approval_for_permission_increase`

`PATCH /v1/workspace/plugin-policy` updates these gates and records an audit event.

## Device Reporting

Installed registry packages are stored as `.install.json` records under the Musubi home directory. `musubi start` merges that trust metadata into plugin capability reports so the control plane can show publisher, trust level, signature status, install source, signing key, and digest.

## Update Review

```sh
go run ./cmd/musubi plugin update-check codex \
  --server http://127.0.0.1:8787 \
  --home .musubi/m4
```

The update check compares the installed record with the latest registry manifest and prints new permissions or channels before an update is accepted.

Registry resolution records `plugin.registry_resolved`, and latest-version checks record `plugin.update_checked`, so install, update review, and device report activity are visible in audit history.
