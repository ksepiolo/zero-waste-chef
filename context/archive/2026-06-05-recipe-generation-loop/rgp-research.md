---
change_id: recipe-generation-loop
type: research
created: 2026-06-05
sources:
  - https://openrouter.ai/docs/guides/features/structured-outputs
  - https://openrouter.ai/docs/api/reference/overview
  - https://openrouter.ai/docs/guides/features/plugins/response-healing
  - https://developers.cloudflare.com/ai-gateway/usage/providers/openrouter/
  - https://developers.cloudflare.com/workers/platform/limits/
  - https://developers.cloudflare.com/workers/best-practices/workers-best-practices/
  - https://openrouter.ai/docs/api/reference/streaming
---

# Research: OpenRouter JSON mode from Cloudflare Workers

## Question

How to call OpenRouter API with JSON mode from Cloudflare Workers using `fetch`, including model selection for S-02 recipe generation loop.

---

## Finding 1: Two JSON mode variants

OpenRouter supports two `response_format` modes:

**`json_object`** — basic; model returns valid JSON but with no schema enforcement:
```typescript
response_format: { type: 'json_object' }
```

**`json_schema`** — strict; model must return JSON matching the exact schema. Recommended for S-02 (guarantees `used_product_ids`, `title`, `ingredients`, `instructions` are always present):
```typescript
response_format: {
  type: 'json_schema',
  json_schema: {
    name: 'recipe',
    strict: true,
    schema: {
      type: 'object',
      properties: {
        title:            { type: 'string' },
        ingredients:      { type: 'array', items: { type: 'string' } },
        instructions:     { type: 'array', items: { type: 'string' } },
        used_product_ids: { type: 'array', items: { type: 'string' } }
      },
      required: ['title', 'ingredients', 'instructions', 'used_product_ids'],
      additionalProperties: false
    }
  }
}
```

Models supporting `json_schema` strict mode: OpenAI GPT-4o+, Google Gemini, Anthropic Claude Sonnet 4.5+, most Fireworks-hosted open-source models.

---

## Finding 2: fetch pattern — fully compatible with Cloudflare Workers

Plain `fetch` works natively in CF Workers. No SDK required.

```typescript
const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
    'Content-Type': 'application/json',
    'HTTP-Referer': 'https://zero-waste-chef.ksepiolo.workers.dev', // optional, for OpenRouter rankings
  },
  body: JSON.stringify({
    model: 'google/gemini-2.0-flash-001',
    messages: [{ role: 'user', content: '...' }],
    response_format: { /* json_schema block */ },
    plugins: [{ id: 'response-healing' }]
  })
});

const data = await response.json();
const recipe = JSON.parse(data.choices[0].message.content);
```

Note: `data.choices[0].message.content` is a **JSON string** — must be `JSON.parse()`-d even with `json_schema` mode.

---

## Finding 3: Response Healing plugin

Add `plugins: [{ id: 'response-healing' }]` to the request body. Activates automatically for non-streaming requests using `response_format` with `json_schema` or `json_object`. Attempts to repair malformed JSON (missing brackets, markdown wrappers, trailing commas). Reduces the risk of parse failures on edge cases. No extra cost.

---

## Finding 4: Env var wiring for this project

Pattern from CLAUDE.md: env vars declared in `astro.config.mjs` `env.schema`, accessed via `astro:env/server`.

**`astro.config.mjs`** — add to env schema:
```typescript
OPENROUTER_API_KEY: envField.string({ context: 'server', access: 'secret' })
```

**Local dev** — add to `.dev.vars` (gitignored, same pattern as `SUPABASE_URL`):
```
OPENROUTER_API_KEY=sk-or-v1-...
```

**Production** — set as Wrangler secret:
```bash
npx wrangler secret put OPENROUTER_API_KEY
```

---

## Finding 5: Model recommendation

| Model | Input / Output (per 1M tokens) | JSON schema | Notes |
|---|---|---|---|
| `google/gemini-2.0-flash-001` | ~$0.10 / $0.40 | ✓ | **Recommended** — cheapest viable option; fast; strong instruction following; handles cooking recipes well |
| `openai/gpt-4o-mini` | $0.15 / $0.60 | ✓ | Reliable fallback; widely tested for structured output |
| `anthropic/claude-haiku-4-5-20251001` | $0.80 / $4.00 | ✓ | Better reasoning; higher cost; overkill for simple recipe generation |

**Decision: `google/gemini-2.0-flash-001`**

Rationale: supports `json_schema` strict mode, strong instruction following for recipe formatting, lowest cost for MVP-scale usage. PRD NFR requires "common home-cooking techniques" — Gemini Flash handles this well. Fallback: `openai/gpt-4o-mini` if schema compliance issues appear in testing.

---

## Finding 6: Workers CPU limits — what counts and what does not

**CPU time ≠ wall time.** From official Cloudflare docs:
> Waiting on network requests (such as `fetch()` calls, KV reads, or database queries) does **not** count toward CPU time.

The entire OpenRouter LLM call (seconds of network wait) costs **zero CPU**. What does consume CPU:
- `JSON.parse()` on the recipe response body (~1–3 ms)
- At-risk window calculation + product list filtering (~0.1 ms)
- Astro/Worker route overhead (~1–2 ms)

Total estimated CPU for `POST /api/recipes/generate`: **~3–6 ms**.

| Tier | CPU limit | Verdict for S-02 |
|---|---|---|
| Free | 10 ms hard | Borderline — risks hitting limit under load |
| Paid | 30 s default (up to 5 min) | Comfortable; **required for production** |

Workers **Paid plan ($5/month)** must be active before deploying the generate endpoint to production. Local dev (`wrangler dev`) has no CPU limit.

Set an explicit ceiling in `wrangler.jsonc` to prevent runaway billing:
```jsonc
{
  "limits": {
    "cpu_ms": 5000
  }
}
```

**Two-endpoint design for S-02** — the approve step is I/O-only and has no CPU concern:

| Endpoint | CPU concern | Notes |
|---|---|---|
| `POST /api/recipes/generate` | ~3–6 ms | Parse + business logic; non-streaming is correct (need full recipe before approval screen) |
| `POST /api/recipes/approve` | < 1 ms | Pure Supabase mutations; trivially cheap |

---

## Finding 7: Atomic approve pattern — PostgreSQL RPC function

`supabase-js` has no transaction API. PostgREST (which it sits on) doesn't support `BEGIN/COMMIT` — every `.from().insert()` + `.from().delete()` call is two independent HTTP requests. For S-02 this violates FR-009 (guardrail: recipe save and product removal must be one unit).

**Pattern: PostgreSQL plpgsql function + `supabase.rpc()`**. The function runs inside Postgres; PostgreSQL wraps it in a transaction automatically. Any `RAISE EXCEPTION` triggers a full rollback.

### Schema gap (found in `supabase/migrations/20260531120000_initial_schema.sql`)

The `recipes` table currently has:
- `instructions TEXT NOT NULL` — single string, not `TEXT[]`
- `consumed_products JSONB NOT NULL` — stores `{name, expiry_date}[]` snapshots, **not** product IDs
- **Missing:** no `ingredients` column — but the AI `json_schema` returns `ingredients: string[]`

A new migration must add `ingredients TEXT[]` and create the `approve_recipe` function.

### Migration (`supabase/migrations/<timestamp>_approve_recipe.sql`)

```sql
ALTER TABLE public.recipes
  ADD COLUMN ingredients TEXT[] NOT NULL DEFAULT '{}';

CREATE OR REPLACE FUNCTION public.approve_recipe(
  p_title            TEXT,
  p_ingredients      TEXT[],
  p_instructions     TEXT,
  p_used_product_ids UUID[]
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY INVOKER   -- runs with calling user's RLS context; auth.uid() set by PostgREST
AS $$
DECLARE
  v_recipe_id         UUID;
  v_consumed_products JSONB;
BEGIN
  -- Snapshot product names+expiry BEFORE deletion (same transaction = consistent read)
  SELECT jsonb_agg(jsonb_build_object('name', name, 'expiry_date', expiry_date))
  INTO   v_consumed_products
  FROM   public.products
  WHERE  id = ANY(p_used_product_ids)
    AND  user_id = auth.uid();

  INSERT INTO public.recipes (user_id, title, ingredients, instructions, consumed_products)
  VALUES (
    auth.uid(),
    p_title,
    p_ingredients,
    p_instructions,
    COALESCE(v_consumed_products, '[]'::jsonb)
  )
  RETURNING id INTO v_recipe_id;

  DELETE FROM public.products
  WHERE id = ANY(p_used_product_ids)
    AND user_id = auth.uid();

  RETURN v_recipe_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.approve_recipe(TEXT, TEXT[], TEXT, UUID[]) TO authenticated;
```

**Why `SECURITY INVOKER` works from CF Workers:** `@supabase/ssr` forwards the user's JWT on every request → PostgREST sets `auth.uid()` from the JWT claim → RLS policies on `products` and `recipes` apply inside the function. No `SET LOCAL ROLE` needed (that's only required for direct Postgres connections).

### CF Workers endpoint call pattern

```typescript
const { data: recipeId, error } = await locals.supabase.rpc('approve_recipe', {
  p_title:            title,
  p_ingredients:      ingredients,          // string[] passed as-is
  p_instructions:     instructions.join('\n'), // string[] → TEXT
  p_used_product_ids: used_product_ids,     // uuid[] passed as-is
});
```

### Atomicity guarantees

| Operation | Guarantee |
|---|---|
| SELECT (snapshot) + INSERT + DELETE | Single Postgres transaction — all or nothing |
| User isolation | `AND user_id = auth.uid()` guard + RLS policy on both tables |
| CPU cost on CF Workers | `supabase.rpc()` is network I/O — zero CPU during Postgres execution; Zod parse ~1 ms |

---

---

## Finding 8: 2026 system prompt structure — four-block pattern

2026 best practices (llmbestpractices.com, May 2026; thetechpost.com, May 2026) establish a canonical four-block system prompt structure that holds shape across models:

```
1. Identity      You are <role> for <domain>.
2. Capabilities  You can <list>.
3. Constraints   You do not <non-goals>. Refuse if <triggers>.
4. Format        Return <schema or shape>. Cap at <bounds>.
```

Rules: output schema belongs in system (durable), not user (per-request). System prompt should be byte-identical across requests for caching. Target 200–800 tokens; beyond that, middle content is ignored.

The current rgp-research.md system prompt is a single sentence. It must be expanded — especially the Constraints block — to satisfy the PRD NFR ("common home-cooking techniques") and prevent the model generating recipes that require specialist equipment or unrealistic time.

**Recommended system prompt for S-02:**

```typescript
content: `You are a practical home-cooking assistant. Rules:
- Techniques: use only sauté, boil, roast, bake, simmer, fry, stir-fry. Never: sous-vide, fermentation, dehydrating, smoking, pressure cooking.
- Equipment: assume stovetop, oven, one pot, one pan, knife, cutting board. No specialty appliances.
- Time: total recipe time (prep + cook) must not exceed 45 minutes.
- Pantry staples are always available: salt, pepper, oil, water, basic dried spices.
- Never ask follow-up questions. Always generate a recipe immediately.
- used_product_ids must contain only UUID strings from the list provided. Never invent or omit IDs.`
```

---

## Finding 9: Gemini 2.0 Flash requires `propertyOrdering`

Google's official structured output docs note: *"Gemini 2.0 requires an explicit `propertyOrdering` list within the JSON input to define the preferred structure."* Without it, field generation order may vary.

Put `used_product_ids` **last** so the model commits to `title`, `ingredients`, and `instructions` before deciding which product IDs to include — this reduces hallucinated or omitted IDs.

```typescript
schema: {
  type: 'object',
  properties: { /* ... */ },
  required: ['title', 'ingredients', 'instructions', 'used_product_ids'],
  additionalProperties: false,
  propertyOrdering: ['title', 'ingredients', 'instructions', 'used_product_ids']
}
```

---

## Finding 10: Temperature — set explicitly for creative-but-constrained generation

2026 structured output guides (genaiunplugged.substack.com): *"For JSON extraction, set temperature to 0.0–0.1. High temperature causes format drift."* With `json_schema` strict mode structural drift is eliminated, but instruction drift in the constraint block is still possible at high temperature.

Recipe generation needs creative variation. **Recommended: `temperature: 0.4`** — enough variation per run, low enough to respect technique/time constraints in the system prompt.

Add to the request body:
```typescript
temperature: 0.4,
```

---

## Finding 11: Zero-shot is not preferred for Gemini — add one few-shot example

Multiple 2026 sources (thetechpost.com, May 2026) confirm: *"For Gemini, examples are essentially required — Google's official docs explicitly state zero-shot is not preferred."*

Add one compact `user`/`assistant` turn before the actual request. This anchors format and shows the model exactly what UUID passthrough looks like:

```typescript
messages: [
  { role: 'system', content: '/* 4-block system prompt */' },
  // Few-shot anchor — shows UUID passthrough and compact format
  {
    role: 'user',
    content: 'Create a recipe that prioritizes using these at-risk ingredients: spinach (id: aaa-bbb-111), garlic (id: ccc-ddd-222). Include the exact product IDs in used_product_ids.'
  },
  {
    role: 'assistant',
    content: JSON.stringify({
      title: 'Garlic Sautéed Spinach',
      ingredients: ['200g fresh spinach', '3 cloves garlic, minced', '2 tbsp olive oil', 'salt to taste'],
      instructions: [
        'Heat oil in a pan over medium heat.',
        'Add garlic and sauté for 1 minute until fragrant.',
        'Add spinach and cook for 3 minutes, stirring, until wilted.',
        'Season with salt and serve immediately.'
      ],
      used_product_ids: ['aaa-bbb-111', 'ccc-ddd-222']
    })
  },
  // Actual request
  {
    role: 'user',
    content: `Create a recipe that prioritizes using these at-risk ingredients: ${productList}. Include the exact product IDs of ingredients you use in used_product_ids.`
  }
]
```

---

## Finding 12: Application-layer Zod validation required after schema parse

2026 structured output guide (zylos.ai, April 2026): *"Schema validates syntax, not semantics. Add application-layer validation."* The `json_schema` constraint cannot verify that returned UUIDs exist in the user's inventory — this is the FR-009 guardrail at the service layer.

Add to `recipe.service.ts` after `JSON.parse()`:

```typescript
import { z } from 'zod';

const GeneratedRecipeSchema = z.object({
  title: z.string().min(1),
  ingredients: z.array(z.string()).min(1),
  instructions: z.array(z.string()).min(1),
  used_product_ids: z.array(z.string().uuid()).min(1),
});

const recipe = GeneratedRecipeSchema.parse(JSON.parse(data.choices[0].message.content));

// Cross-check: all returned IDs must belong to the original product list
const validIds = new Set(atRiskProducts.map(p => p.id));
const allValid = recipe.used_product_ids.every(id => validIds.has(id));
if (!allValid) throw new Error('Model returned unknown product IDs — inventory guardrail violated');
```

Zod is already in `package.json` (`zod ^4.4.3`) — no new dependency needed.

---

## Correctness check against existing findings

| Finding | Status | Note |
|---|---|---|
| Finding 1: `json_schema` strict mode | ✓ correct | Still the production default in 2026 |
| Finding 2: `fetch` pattern for CF Workers | ✓ correct | No SDK needed |
| Finding 3: Response Healing plugin | ✓ correct | Still valid; add alongside temp + few-shot |
| Finding 4: Env var wiring via `astro:env/server` | ✓ correct | Unchanged |
| Finding 5: `google/gemini-2.0-flash-001` | ✓ correct | Still cheapest viable model for this use case |
| Finding 6: CF Workers CPU limits | ✓ correct | Paid plan still required for production |
| Finding 7: Atomic approve via PostgreSQL RPC | ✓ correct | Still the right atomicity pattern |
| System prompt (one sentence) | ✗ incomplete | Missing Constraints block — see Finding 8 |
| `propertyOrdering` | ✗ missing | Required for Gemini 2.0 — see Finding 9 |
| `temperature` | ✗ missing | Must be set explicitly — see Finding 10 |
| Few-shot example | ✗ missing | Zero-shot not preferred for Gemini — see Finding 11 |
| Semantic ID validation | ✗ missing | FR-009 service-layer guardrail — see Finding 12 |

---

## Proposed service shape

```typescript
// src/lib/services/recipe.service.ts
import { OPENROUTER_API_KEY } from 'astro:env/server';

interface GeneratedRecipe {
  title: string;
  ingredients: string[];
  instructions: string[];
  used_product_ids: string[];
}

export async function generateRecipe(
  atRiskProducts: { id: string; name: string }[]
): Promise<GeneratedRecipe> {
  const productList = atRiskProducts
    .map(p => `${p.name} (id: ${p.id})`)
    .join(', ');

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://zero-waste-chef.ksepiolo.workers.dev',
    },
    body: JSON.stringify({
      model: 'google/gemini-2.0-flash-001',
      messages: [
        {
          role: 'system',
          content: 'You are a practical home-cooking assistant. Generate recipes using common home-cooking techniques. Assume standard pantry staples (salt, oil, water) are always available. Never ask follow-up questions — always generate a recipe immediately.'
        },
        {
          role: 'user',
          content: `Create a recipe that prioritizes using these at-risk ingredients: ${productList}. Include the exact product IDs of ingredients you use in used_product_ids.`
        }
      ],
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'recipe',
          strict: true,
          schema: {
            type: 'object',
            properties: {
              title:            { type: 'string', description: 'Recipe name' },
              ingredients:      { type: 'array', items: { type: 'string' }, description: 'Full ingredient list including quantities' },
              instructions:     { type: 'array', items: { type: 'string' }, description: 'Step-by-step cooking instructions, one step per item' },
              used_product_ids: { type: 'array', items: { type: 'string' }, description: 'IDs of the at-risk products used in this recipe' }
            },
            required: ['title', 'ingredients', 'instructions', 'used_product_ids'],
            additionalProperties: false
          }
        }
      },
      plugins: [{ id: 'response-healing' }]
    })
  });


  if (!response.ok) {
    const err = await response.text();
    throw new Error(`OpenRouter ${response.status}: ${err}`);
  }

  const data = await response.json();
  return JSON.parse(data.choices[0].message.content) as GeneratedRecipe;
}
```
