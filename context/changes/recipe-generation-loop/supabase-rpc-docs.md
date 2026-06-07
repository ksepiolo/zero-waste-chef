# Supabase RPC — Calling PostgreSQL Functions from Cloudflare Workers

Source: Context7 / @supabase/supabase-js v2 + @supabase/ssr  
Fetched: 2026-06-07

## Use case

Calling `approve_recipe(p_title, p_ingredients, p_instructions, p_used_product_ids)` from an Astro/Cloudflare Workers API route and getting back a UUID.

---

## 1. Basic RPC call pattern

```typescript
// src/pages/api/recipes/approve.ts
import type { APIContext } from "astro";
import { createClient } from "@/lib/supabase";

export const prerender = false;

export async function POST({ request, cookies }: APIContext) {
  const supabase = createClient(cookies);
  if (!supabase) return new Response("Service unavailable", { status: 503 });

  const body = await request.json();

  const { data, error } = await supabase
    .rpc("approve_recipe", {
      p_title: body.title,
      p_ingredients: body.ingredients,
      p_instructions: body.instructions,
      p_used_product_ids: body.usedProductIds,
    })
    .returns<string>(); // UUID → string; omit if using generated Database types

  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });

  return new Response(JSON.stringify({ id: data }), { status: 200 });
}
```

---

## 2. With generated Database types (preferred)

When using `supabase gen types typescript`, the client infers arg and return types automatically from `Database['public']['Functions']['approve_recipe']`. No `.returns<T>()` needed.

```typescript
import type { Database } from "@/types/database.types"; // generated

// createClient already typed with Database — rpc() infers Args + Returns
const { data, error } = await supabase.rpc("approve_recipe", {
  p_title: "...",
  p_ingredients: [...],
  p_instructions: "...",
  p_used_product_ids: [...],
});
// data is typed as the function's declared return type (uuid → string in TS)
```

---

## 3. RPC method signature (from source)

```typescript
rpc<
  FnName extends string & keyof Schema['Functions'],
  Args extends Schema['Functions'][FnName]['Args'] = never,
>(
  fn: FnName,
  args: Args = {} as Args,
  {
    head,   // boolean — send HEAD request
    get,    // boolean — send GET request (args become query params)
    count,  // 'exact' | 'planned' | 'estimated'
  } = {}
): PostgrestFilterBuilder
```

- Default HTTP method: `POST` (args sent as JSON body to `/rest/v1/rpc/<fn>`)
- Supports chaining: `.select()`, `.single()`, `.returns<T>()`, filter methods

---

## 4. Key facts

| Detail | Value |
|---|---|
| Method | `supabase.rpc(fn_name, args_object)` |
| Args object keys | Must match PostgreSQL parameter names exactly (including `p_` prefix) |
| Return shape | `{ data, error }` |
| UUID return | PostgreSQL `uuid` → TypeScript `string` |
| Typing without generated types | Chain `.returns<string>()` after `.rpc()` |
| Error shape | `error.message`, `error.code` (PostgREST error codes) |

---

## 5. Array / JSONB arguments

Pass JS arrays and objects directly — the client serializes them correctly:

```typescript
p_ingredients: ["onion", "garlic"],        // maps to text[]
p_used_product_ids: ["uuid-1", "uuid-2"], // maps to uuid[]
p_instructions: { steps: [...] },          // maps to jsonb
```

---

## 6. `.returns<T>()` for manual typing

Use when Database-generated types are not available:

```typescript
const { data } = await supabase
  .rpc("approve_recipe", { ... })
  .returns<string>();
// data: string | null
```

Also works with `.single()` and `.maybeSingle()` on table queries.

---

## Sources

- https://github.com/supabase/supabase-js/blob/master/packages/core/postgrest-js/src/PostgrestClient.ts
- https://github.com/supabase/supabase-js/blob/master/packages/core/postgrest-js/test/rpc.test.ts
- https://github.com/supabase/supabase-js/blob/master/packages/core/postgrest-js/test/advanced_rpc.test.ts
- https://github.com/supabase/ssr/blob/main/_autodocs/README.md
