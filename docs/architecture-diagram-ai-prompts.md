# Architecture Diagram AI Prompts

Use the prompts below with ChatGPT, Claude, Gemini, or any diagram AI tool.

## Prompt 1: Business Architecture Diagram

```text
You are a senior enterprise architect. Create a BUSINESS architecture system diagram for a single-client SACCOS deployment.

Output requirements:
1) Output Mermaid code only for the main diagram (no markdown explanation before it).
2) Then provide a short legend and 8-12 architecture notes.
3) Use clear business domains and actor-to-capability mapping.

Business context to model:
- Platform type: Client-specific SACCOS management system deployed for one cooperative.
- Main actors:
  - System Owner / Implementer
  - Super Admin
  - Branch Manager
  - Loan Officer
  - Teller
  - Auditor (read-only)
  - Member (member portal)
- Core business capabilities:
  - Workspace setup and branch/staff provisioning
  - Member onboarding and member applications
  - Savings/share contributions
  - Loan lifecycle (draft, submit, appraise, approve/reject, disburse, repay)
  - Dividends lifecycle
  - Cash control and receipts
  - Reports and audit oversight
  - Member portal visibility
- Governance rules:
  - Role-based approvals and maker-checker controls
  - Backend-enforced controls (not UI-only)
  - Branch/workspace scoping across data and operations
- Authentication journey:
  - User signs in with Supabase credentials first
  - OTP is second factor after base sign-in (conditional by user policy/profile)
- Business outcomes to show:
  - Financial safety
  - Operational efficiency
  - Transparency and audit readiness
  - Scalable operations across branches and members

Diagram style:
- Group by business domains/capability blocks.
- Include arrows from actors to capabilities.
- Show governance/compliance as a cross-cutting layer.
- Keep layout executive-friendly (board presentation quality).
```

## Prompt 2: Technical Architecture Diagram

```text
You are a principal solution architect. Create a TECHNICAL architecture diagram set for this system.

Output requirements:
1) Provide 3 Mermaid diagrams in this order:
   - Diagram A: Container/System Context diagram
   - Diagram B: Sign-in + OTP sequence diagram
   - Diagram C: Deployment diagram
2) After diagrams, provide:
   - key trust boundaries
   - security controls
   - failure handling notes
3) Keep it implementation-aligned (not generic).

System implementation details:
- Frontend:
  - React + TypeScript + Vite + MUI
  - Uses Supabase browser auth client for primary auth
  - Routes include public landing/sign-in, role-based workspace, member portal
- Backend:
  - Node.js + Express API
  - JWT auth middleware, RBAC middleware, compatibility status/feature enforcement, idempotency, approvals
  - Mounted modules include auth, me, branches, users, members, member-applications, loan-applications, finance, cash-control, dividends, auditor, reports, observability, credit-risk, approvals, notification-settings, member-payments
  - Uses Supabase admin client and SQL/RPC procedures
- Runtime note:
  - Active deployment is single-client and single-workspace
  - Legacy schema and compatibility endpoints still use tenant/subscription terminology in some places
- OTP flow:
  - After base sign-in passes, backend sends OTP via SMS gateway
  - SMS endpoint: POST /api/sms/v1/text/single at messaging-service.co.tz
  - Authorization header uses Basic token from environment variables
  - Sender ID comes from env (e.g., Moinfo)
  - OTP has short expiry, resend rate-limit, and no plaintext persistence/logging
- Data and integration:
  - Primary data in Supabase/Postgres
  - External SMS provider integration for OTP delivery
- Deployment:
  - Docker Compose deployment
  - Backend service + frontend service + environment-driven config

Must include these technical flows:
- Login path: Frontend -> Supabase auth -> Backend profile/RBAC checks -> OTP send -> OTP verify -> session continuation
- Role authorization path on API endpoints
- Financial operation path with idempotency and audit logging
- Read-only auditor access path
- Workspace status/capability lookup path via `/api/me/subscription`
- Error paths for OTP gateway failures (401/403/5xx) and fallback handling

Quality constraints:
- Label protocols (HTTPS/REST/JWT).
- Label trust boundaries (browser, API, DB, third-party SMS).
- Show where rate limiting, RBAC, approval checks, and compatibility status guards are enforced.
- Use concise component names and directional arrows.
```

## Prompt 3: Combined Deliverable (Business + Technical in One Go)

```text
Create a complete architecture pack for a single-client SACCOS deployment.

Deliverables:
1) Business architecture diagram (Mermaid).
2) Technical architecture container diagram (Mermaid).
3) Sign-in + OTP sequence diagram (Mermaid).
4) Deployment diagram (Mermaid).
5) One-page assumptions and risks table.

Use these system facts:
- Roles: system owner, super admin, branch manager, loan officer, teller, auditor, member.
- Backend: Node/Express, Supabase admin integration, RBAC, approvals, idempotency, and compatibility status/capability middleware.
- Frontend: React/Vite/MUI, Supabase browser auth.
- OTP is a second factor after successful base sign-in and is delivered via messaging-service.co.tz SMS API using Basic Authorization from env.
- Core domains: workspace administration, member onboarding, savings/shares, loans, dividends, cash control, reporting, auditing.
- Governance constraints: maker-checker, role-bound approvals, backend-enforced controls, branch/workspace scoping.

Formatting constraints:
- Mermaid only for diagrams.
- Clear titles for each diagram.
- Practical notes for engineering + business stakeholders.
- No fictional components.
```
