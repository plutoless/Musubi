Repo strategy:
- Start with one monorepo: musubi
- Keep open-source boundaries clean from day one
- CLI, specs, SDK, plugins are first-class public modules
- Cloud control plane can live in repo first, but keep it separable
- Do not split into many repos until real external contributors appear