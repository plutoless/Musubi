# Musubi M1.6 Runtime Hardening Plan

M1.6 hardens the Codex plugin/runtime boundary before Musubi grows additional local capabilities.

## Scope

- Keep plugin dispatch isolated to explicit plugin channels and local policy.
- Make Codex runtime execution bounded, observable, and sanitized.
- Add negative-path verification for server grants, local policy, unsupported plugin channels, runtime failures, and runtime timeouts.
- Keep audit/status records payload-opaque.

## Done Criteria

- Codex plugin rejects unsupported `codex.*` channels instead of treating them as task creation.
- Configured Codex runtimes have an explicit timeout and maximum stdout size.
- Runtime failures return encrypted structured error fields with sanitized text only.
- CLI message status reflects plugin-reported failure status.
- Negative verifiers cover denied channel, missing grant, unsupported Codex channel, runtime exit failure, runtime timeout, and output truncation.
- Verifiers assert denied prompts/results do not leak into local audit/status JSON or deployed Neon failed-message/audit rows.
- GitHub Actions runs the M1.6 hardening verifier on every push and pull request.

## Non-Goals

- Full process sandboxing or OS-level isolation.
- Interactive local confirmation UX beyond the existing policy gate.
- A production Codex CLI integration contract beyond the configured command adapter.
