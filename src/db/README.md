Database-facing assets live primarily in `supabase/sql` for:

- schema
- RLS policies
- procedures/functions
- additive migrations

Use `src/db/` for backend-side database helpers that should stay close to the service layer, for example:

- SQL query templates used by Node services
- reusable repository utilities
- migration helpers that are not route-specific

Do not place secrets or environment credentials in this folder.
