# Lessons Learned

> Append-only register of recurring rules and patterns. Re-read at start by /10x-frame, /10x-research, /10x-plan, /10x-plan-review, /10x-implement, /10x-impl-review.

## Always add an app-layer user_id filter alongside RLS on read and delete queries

- **Context**: src/lib/services/product.service.ts — listProducts query had no .eq("user_id", userId) clause
- **Problem**: Data isolation relying solely on RLS is silently bypassed by any service-role client or accidental RLS disable, making all users' rows visible or mutable without error.
- **Rule**: Every service function that reads or deletes user-owned rows must receive userId and chain .eq("user_id", userId), regardless of whether RLS is also in place.
- **Applies to**: All Supabase service functions in src/lib/services/ that operate on user-owned tables
