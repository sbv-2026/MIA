# AGENTS.md

## Project overview

This workspace contains two related demo projects:

- [DemoMSBWeb/README.md](DemoMSBWeb/README.md): host banking web app + demo banking API
- [MIAAssistant/README.md](MIAAssistant/README.md): standalone MIA assistant stack (assistant web, agent API, shared contracts)

They are intentionally separated, but share a common theme: banking workflows, demo integrations, and AI-assisted troubleshooting. Keep changes scoped to the relevant project unless a cross-project update is clearly required.

## Working conventions

- Prefer the smallest change that fixes the task in the relevant app or package.
- Do not duplicate configuration between the two projects unless the repo explicitly expects it.
- Prefer existing patterns and docs over inventing new structures.
- When a task touches product behavior, check the project README and docs before changing contracts, env variables, or request/response flows.

## Build and test commands

### DemoMSBWeb

```powershell
cd DemoMSBWeb
npm ci
npm run build
cd services\demo-banking-api
python -m pip install -e ".[test]"
python -m pytest
cd ..\..
docker compose up --build
```

Relevant docs:
- [DemoMSBWeb/README.md](DemoMSBWeb/README.md)
- [DemoMSBWeb/docs/architecture.md](DemoMSBWeb/docs/architecture.md)

### MIAAssistant

```powershell
cd MIAAssistant
npm install
npm run build
python -m pip install -e ".\services\agent-api[test]"
python -m pytest services\agent-api\tests
docker compose up --build
```

Relevant docs:
- [MIAAssistant/README.md](MIAAssistant/README.md)
- [MIAAssistant/docs/architecture.md](MIAAssistant/docs/architecture.md)
- [MIAAssistant/docs/deployment.md](MIAAssistant/docs/deployment.md)
- [MIAAssistant/docs/mia-scenarios.md](MIAAssistant/docs/mia-scenarios.md)

## Architecture and boundaries

- Frontends are Vite + React + TypeScript apps.
- Shared packages are in [MIAAssistant/packages](MIAAssistant/packages) and are built with npm workspaces.
- The assistant backend is Python-based under [MIAAssistant/services/agent-api](MIAAssistant/services/agent-api).
- Demo banking backend is Python-based under [DemoMSBWeb/services/demo-banking-api](DemoMSBWeb/services/demo-banking-api).
- Environment-driven config is important; for MIAAssistant, review the README before changing model/provider variables.

## Common pitfalls

- Do not assume the demo web app and assistant app are the same runtime; they are separate deployments and may run on different ports.
- For MIAAssistant, model/provider configuration is backend-only and should not be exposed to browser code.
- Do not change vendor or generated contract artifacts unless the task explicitly requires it and the docs instruct you to do so.
- When editing YAML or knowledge config, reload the service via the documented endpoint if the project expects runtime reload without rebuild.

## Documentation to consult

Prefer the specific docs in the relevant project before making edits:

- [DemoMSBWeb/README.md](DemoMSBWeb/README.md)
- [MIAAssistant/README.md](MIAAssistant/README.md)
- [MIAAssistant/docs/architecture.md](MIAAssistant/docs/architecture.md)
- [MIAAssistant/docs/deployment.md](MIAAssistant/docs/deployment.md)
- [MIAAssistant/docs/contracts-versioning.md](MIAAssistant/docs/contracts-versioning.md)
- [DemoMSBWeb/docs/architecture.md](DemoMSBWeb/docs/architecture.md)

## Expected agent behavior

When working in this repo:

1. Identify which project the task belongs to before editing files.
2. Use the project README and architecture docs to confirm conventions and runtime assumptions.
3. Use the relevant build/test commands, not generic commands that do not match the project.
4. Keep changes narrowly scoped and avoid refactors unless necessary to complete a task.
5. If a task depends on external config, respect env-driven behavior and avoid hardcoding secrets or provider details in frontend code.
