# Deployment Notes

## Runtime

- Node.js 20 or later.
- Deploy the API as a stateless process behind a TLS terminator or load balancer.
- Set `SSL_ENABLED=true` in production and terminate HTTPS at the edge.
- Use at least two application instances for horizontal scaling.

## Docker Compose

The backend is ready to deploy with:

- [Dockerfile](/Users/pastoryjoseph/Desktop/saccos-backend/Dockerfile)
- [docker-compose.yml](/Users/pastoryjoseph/Desktop/saccos-backend/docker-compose.yml)

Recommended server flow:

1. Copy `.env.example` to `.env`
2. Fill all production environment variables
3. Build and start:

```bash
docker compose build
docker compose up -d
```

4. Watch startup:

```bash
docker compose logs -f backend
```

5. Verify health:

```bash
curl http://127.0.0.1:5000/health
```

Operational notes:

- keep `.env` on the server only
- put the container behind Nginx/Caddy/Traefik for TLS termination
- the compose service runs with `restart: unless-stopped`
- the image uses a non-root `node` user
- the container includes a healthcheck against `/health`

## Environment

- Populate the variables in `.env.example`.
- Never expose `SUPABASE_SERVICE_ROLE_KEY` outside the backend runtime.
- Keep `SUPABASE_ANON_KEY` public but restricted to the frontend origin list.

## Supabase Setup

1. Run the SQL files in order:
   1. `supabase/sql/001_schema.sql`
   2. `supabase/sql/002_rls.sql`
   3. `supabase/sql/003_procedures.sql`
   4. `supabase/sql/001_plans.sql`
   5. `supabase/sql/002_rls_plans.sql`
   6. `supabase/sql/004_shares_and_dividends.sql`
   7. `supabase/sql/005_dividend_module.sql`
   8. `supabase/sql/006_performance_indexes.sql`
   9. `supabase/sql/007_loan_accounts.sql`
   10. `supabase/sql/008_loan_repayment_tracking_fix.sql`
   11. `supabase/sql/009_auditor_upgrade.sql`
2. Verify that RLS is enabled on every table and that `service_role` can execute the financial procedures.
3. Seed the first tenant through `POST /api/tenants` using an internal operations user.

## Database Performance

- After applying new indexes, allow autovacuum/analyze to refresh statistics or run `analyze` during a maintenance window.
- Recheck the slowest tenant-scoped queries after large demo seeds or bulk imports.
- Prioritize `explain analyze` on:
  - member statements
  - loan aging / PAR
  - tenant subscription lookups
  - dividend cycle freeze and allocation paths
- Keep additive indexes aligned with real query patterns; avoid broad speculative indexes.

## Security

- Enforce TLS end to end.
- Store secrets in a managed secret store.
- Rotate `SUPABASE_SERVICE_ROLE_KEY` on a schedule.
- Restrict Supabase dashboard access with MFA.
- Enable Supabase point-in-time recovery, daily backups, and snapshot retention.
- Review audit logs continuously and forward application logs to a SIEM.

## Availability

- Use a health probe against `/health` or `/api/health`.
- Configure readiness checks after environment validation completes.
- Keep the application stateless so instances can scale horizontally.
- Use rolling deployments and terminate gracefully with SIGTERM.

## Batch Jobs

- Schedule `POST /api/interest-accrual` nightly.
- Schedule `POST /api/close-period` at the end of each reporting period after reconciliation.

## Operational Validation

- Reconcile journal balances against source account balances after each deployment.
- Run smoke tests for deposit, withdrawal, loan disbursement, and repayment in a staging tenant before production rollout.
