import { useCallback, useState } from "react";
import type { ExcludedProduct, GeneratedRecipe, RecipeParams } from "@/types";

interface Options {
  onApproveSuccess?: (deletedIds: string[], skippedIds: string[]) => void;
  // Fires only when the endpoint actually held products back, so the component never has to
  // check for an empty list before deciding whether to say anything.
  onExpiredExcluded?: (excluded: ExcludedProduct[]) => void;
}

/**
 * An error body is not guaranteed to be JSON — Astro's HTML 500 page and Cloudflare's 1102
 * page both reach the browser. `res.json()` on those throws a SyntaxError quoting the body
 * prefix, and the callers toast `err.message` verbatim, which would re-open the channel the
 * server-side error contract exists to close.
 */
async function errorMessage(res: Response, fallback: string): Promise<string> {
  try {
    const { error } = JSON.parse(await res.text()) as { error?: string };
    return error ?? fallback;
  } catch {
    return fallback;
  }
}

export function useRecipeGeneration({ onApproveSuccess, onExpiredExcluded }: Options = {}) {
  const [isGenerating, setIsGenerating] = useState(false);
  const [isApproving, setIsApproving] = useState(false);
  const [recipe, setRecipe] = useState<GeneratedRecipe | null>(null);
  // Titles shown this session. Sent to the API so "Generate Different Recipe"
  // actually gets a different dish instead of repeating the same request.
  const [seenTitles, setSeenTitles] = useState<string[]>([]);

  // `params` arrives as an argument rather than hook state — the component owns the
  // selection, so a regenerate must pass the same values the original request used.
  // That is also why it is absent from the dependency list below.
  const generate = useCallback(
    async (params: RecipeParams) => {
      setIsGenerating(true);
      setRecipe(null);

      try {
        const res = await fetch("/api/recipes/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          // Most recent only — the endpoint caps excludeTitles at 10.
          body: JSON.stringify({ excludeTitles: seenTitles.slice(-10), ...params }),
        });

        // Before any parse: a non-2xx body may not be JSON at all.
        if (!res.ok) {
          throw new Error(await errorMessage(res, "Failed to generate recipe"));
        }

        const json = (await res.json()) as {
          recipe?: GeneratedRecipe;
          excluded_expired?: ExcludedProduct[];
        };

        const generated = json.recipe;
        if (!generated) {
          throw new Error("Failed to generate recipe");
        }

        setRecipe(generated);
        setSeenTitles((prev) => [...prev, generated.title]);

        // After the recipe is set, so the suggestion is what the user sees first — the
        // exclusion is context for it, not a failure.
        const excluded = json.excluded_expired ?? [];
        if (excluded.length > 0) {
          onExpiredExcluded?.(excluded);
        }
      } finally {
        setIsGenerating(false);
      }
    },
    [seenTitles, onExpiredExcluded],
  );

  const approve = useCallback(async () => {
    // Captured so the callback still has it after the await boundary.
    const current = recipe;
    if (!current) return;

    setIsApproving(true);

    try {
      const res = await fetch("/api/recipes/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: current.title,
          ingredients: current.ingredients,
          instructions: current.instructions,
          usedProductIds: current.used_product_ids,
        }),
      });

      if (!res.ok) {
        throw new Error(await errorMessage(res, "Failed to approve recipe"));
      }

      const { deletedIds } = (await res.json()) as { deletedIds: string[] };
      // The set the server actually deleted may be a strict subset of what was sent —
      // stale, foreign, or already-deleted ids are silently excluded server-side.
      const skippedIds = current.used_product_ids.filter((id) => !deletedIds.includes(id));
      onApproveSuccess?.(deletedIds, skippedIds);
      setRecipe(null);
      // Inventory just changed — previous suggestions are no longer relevant.
      setSeenTitles([]);
    } finally {
      setIsApproving(false);
    }
  }, [recipe, onApproveSuccess]);

  const reset = useCallback(() => {
    setRecipe(null);
  }, []);

  return { isGenerating, isApproving, recipe, generate, approve, reset };
}
