import { useCallback, useState } from "react";
import type { GeneratedRecipe } from "@/types";

interface Options {
  onApproveSuccess?: (usedProductIds: string[]) => void;
}

export function useRecipeGeneration({ onApproveSuccess }: Options = {}) {
  const [isGenerating, setIsGenerating] = useState(false);
  const [isApproving, setIsApproving] = useState(false);
  const [recipe, setRecipe] = useState<GeneratedRecipe | null>(null);
  // Titles shown this session. Sent to the API so "Generate Different Recipe"
  // actually gets a different dish instead of repeating the same request.
  const [seenTitles, setSeenTitles] = useState<string[]>([]);

  const generate = useCallback(async () => {
    setIsGenerating(true);
    setRecipe(null);

    try {
      const res = await fetch("/api/recipes/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ excludeTitles: seenTitles }),
      });

      const json = (await res.json()) as { recipe?: GeneratedRecipe; error?: string };
      if (!res.ok) {
        throw new Error(json.error ?? "Failed to generate recipe");
      }

      const generated = json.recipe ?? null;
      setRecipe(generated);
      if (generated) {
        setSeenTitles((prev) => [...prev, generated.title]);
      }
    } finally {
      setIsGenerating(false);
    }
  }, [seenTitles]);

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

      const json = (await res.json()) as { id?: string; error?: string };
      if (!res.ok) {
        throw new Error(json.error ?? "Failed to approve recipe");
      }

      onApproveSuccess?.(current.used_product_ids);
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
