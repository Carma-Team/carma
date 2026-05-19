\# CARMA - Unified Monorepo Configuration



\## Project Context

CARMA is a mobile platform that monitors and rates driving behavior in real-time to improve road safety via gamification.

This repository is organized as a Monorepo containing the React Native client, Backend server, and shared data layers.



\## Core Team Roles

\- \*\*Dan (Me - CTO \& CPO):\*\* Core AI/ML formulas, Driving SDK physics, sensor-fusion logic, and anti-fraud mechanics.

\- \*\*Naveh (Chief Architect \& Data Engineer):\*\* Database architecture, cache layers, data pipelines, and Monorepo structure integrity.

\- \*\*Sean (CEO \& Backend Developer):\*\* Business logic API endpoints, cloud infrastructure (AWS), and third-party integrations.

\- \*\*Mai (UI/UX Developer):\*\* Mobile application screens, styling, design components, and client-side interactions.



\---



\## Workspace Layout \& Commands

\*(Verify and adjust paths based on the local repository structure initialized by Naveh)\*



\### Frontend Client

\- \*\*Path:\*\* `./frontend` or `./apps/mobile`

\- \*\*Install:\*\* `npm install` or `yarn install`

\- \*\*Run Tests:\*\* `npx jest --no-coverage`



\### Backend Server

\- \*\*Path:\*\* `./server`

\- \*\*Install:\*\* `pip install -r requirements.txt` (dev: `requirements-dev.txt`)

\- \*\*DB Migrations:\*\* `cd server && alembic upgrade head`



\---



\## Executive Guidelines \& Developer Personas



\### System-Wide Rules

1\. \*\*Data Model Synchronization:\*\* Any change to API contracts or data transfer objects (DTOs) MUST be synchronized with Naveh's DB schema definition to prevent pipeline breaks.

2\. \*\*Shared Types:\*\* Prioritize using a shared types package (`./shared` or `./packages/types`) for interfaces passing between Client and Server.

3\. \*\*No Stubs:\*\* Implement full, functional, and production-ready code. Never commit empty code blocks or unhandled `// TODO` stubs.



\### Dan's Developer Persona (Active when user is Dan)

1\. \*\*Full CTO Autonomy:\*\* You hold complete executive authority to read, write, modify files, and execute deployment/git workflows autonomously.

2\. \*\*One-Shot Execution:\*\* Do not halt tasks to request micro-confirmations or generate abstract implementation plans unless extreme ambiguity is present.

3\. \*\*Guardrails Action:\*\* If local test suites pass successfully, you are authorized to auto-commit and merge local feature branches. Do NOT force-push directly to remote `main` if shared team history is modified without direct user input.



\### Naveh's \& Sean's Developer Personas (Reference)

\- Focus on database normalization, caching performance, API contract stability, and migration safety.

