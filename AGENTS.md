# AGENTS.md

## Repository Context

This repository is for **Musubi / 結び**, a secure app-to-device messaging layer for invoking approved local capabilities on user-owned machines.

Musubi's intended shape is a monorepo:

- Keep open-source boundaries clean from day one.
- Treat CLI, protocol specs, SDKs, and plugins as first-class public modules.
- The cloud control plane may live in this repo initially, but keep it separable.
- Do not split into many repositories until there are real external contributors.

Current repo state:

- `docs/musubi_prd_v_1.md` contains the product requirements and core concepts.
- `docs/policy.md` contains the initial repository strategy.
- There is no application code yet.

## Product Principles

- Musubi is not a VPN, SSH replacement, remote desktop tool, or generic remote-control system.
- The server should handle identity, authorization, routing, status, and audit metadata.
- Business payloads should remain opaque to the server.
- Local execution should be mediated through explicit plugins, permissions, and local policy.
- Prefer precise language such as "invoke approved local capabilities" over "remote control your machine."

## Expected Future Structure

When implementation starts, prefer a layout similar to:

- `docs/` for PRDs, architecture notes, specs, and policy documents.
- `crates/` or `packages/cli/` for the Musubi CLI, depending on chosen language.
- `packages/sdk-*` for app-side SDKs.
- `plugins/` for first-party local capability plugins.
- `apps/control-plane/` for any web control plane.
- `specs/` for wire protocol, envelope, auth, and plugin contracts.

Do not introduce the full structure before there is real code that needs it.

## Engineering Guidance

- Read the PRD before making product or architecture changes.
- Keep implementation boundaries aligned with the public/open-source split.
- Prefer explicit protocol contracts over ad hoc message shapes.
- Avoid server-side payload interpretation unless the product direction explicitly changes.
- Add tests alongside code once implementation begins.
- Keep docs updated when changing core terminology, trust boundaries, protocol behavior, or repo structure.

