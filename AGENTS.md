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

## Planning and Goal-Forge Procedure

For substantial product, architecture, security, auth, or multi-module refactors, do not jump directly into implementation.

Use this procedure:

1. Draft or update a plan/spec document under `docs/`.
2. Capture the problem statement, target user model, product flow, refactoring goals, non-goals, security requirements, implementation slices, and draft acceptance criteria.
3. Keep open questions explicit in the plan document.
4. Discuss open questions with the user and record decisions in the document as they are made.
5. Remove resolved items from the Open Decisions section.
6. Do not compile to `GOAL.md` or start a long-running implementation until acceptance criteria are concrete and user-approved.
7. When using `goal-forge`, treat the plan/spec as the source for `GOAL.md`, and ensure `done_when` names concrete commands, artifacts, or user-observable behaviors.

Good planning behavior:

- Prefer concrete tradeoffs over vague options.
- Recommend a default when the tradeoff is engineering-driven.
- Ask the user when the choice defines product intent.
- Record explicit non-goals to prevent scope creep.
- Keep security boundaries visible, especially around identity, grants, credentials, private keys, and server-blind payloads.
