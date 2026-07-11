# Supabase Security Controls

These controls are release blockers because they cannot be changed safely through database migrations.

## Required before production release

- Enable **Leaked password protection** in Supabase Dashboard under Authentication > Sign In / Up > Password Security.
- Rotate the exposed legacy `service_role` JWT and update server-only Vercel environment variables. Never place it in a `NEXT_PUBLIC_*` variable.
- Prefer a modern publishable key in the browser and a separately rotatable secret key on trusted servers.
- Change the Auth database connection allocation from an absolute count to a plan-appropriate percentage after checking peak connection use.
- Capture the operator, timestamp, and post-change advisor result in the release ticket.

## Verification

Run Supabase security and performance advisors after the changes. Security must report no WARN findings. Performance WARN findings must also be zero; INFO findings require an owner and workload evidence, not blind index deletion.

- Password protection reference: https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection
- Database linter reference: https://supabase.com/docs/guides/database/database-linter
