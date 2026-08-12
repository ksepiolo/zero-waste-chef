import { useState } from "react";
import type { Recipe, RecipePage } from "@/types";
import { RECIPES_PAGE_SIZE } from "@/types";
import { Button } from "@/components/ui/button";
import { ChevronDown } from "lucide-react";
import { toast } from "sonner";

interface Props {
  initialPage: RecipePage;
  loadError: boolean;
}

// Locale and time zone are pinned deliberately. client:load server-renders this island
// before hydrating it, so an implicit locale resolves to the host's default on the server
// and the visitor's in the browser — a hydration mismatch, and for a TIMESTAMPTZ near
// midnight, two different calendar days.
function formatDate(createdAt: string): string {
  return new Date(createdAt).toLocaleDateString("en-GB", {
    timeZone: "UTC",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function RecipeHistoryPanel({ initialPage, loadError }: Props) {
  const [pageData, setPageData] = useState<RecipePage>(initialPage);
  const [page, setPage] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const totalPages = Math.max(1, Math.ceil(pageData.total / RECIPES_PAGE_SIZE));
  const showPagination = pageData.total > RECIPES_PAGE_SIZE;

  async function goToPage(next: number) {
    setIsLoading(true);
    try {
      const res = await fetch(`/api/recipes?page=${String(next)}`);
      if (!res.ok) {
        const json = (await res.json()) as { error?: string };
        toast.error(json.error ?? "Failed to load recipes");
        return;
      }
      const json = (await res.json()) as RecipePage;
      setPageData(json);
      setPage(next);
      // The expanded row is gone from the DOM after a page turn; drop the reference.
      setExpandedId(null);
    } catch {
      toast.error("Network error. Please try again.");
    } finally {
      setIsLoading(false);
    }
  }

  if (loadError) {
    return <p className="text-sm text-red-300">Couldn&apos;t load your recipes — refresh to try again</p>;
  }

  return (
    <div className="space-y-6">
      {pageData.recipes.length === 0 ? (
        // Kept inside the shell rather than an early return: a page that has gone empty
        // because rows were removed still needs its Previous button to get back.
        <p className="text-sm text-white/50">No recipes yet — approved recipes will appear here</p>
      ) : (
        <ul className="space-y-2">
          {pageData.recipes.map((recipe) => (
            <RecipeEntry
              key={recipe.id}
              recipe={recipe}
              isExpanded={expandedId === recipe.id}
              onToggle={() => {
                setExpandedId((prev) => (prev === recipe.id ? null : recipe.id));
              }}
            />
          ))}
        </ul>
      )}

      {showPagination && (
        <div className="flex items-center justify-between">
          <Button
            onClick={() => void goToPage(page - 1)}
            disabled={page <= 1 || isLoading}
            className="border border-white/20 bg-white/10 text-white hover:bg-white/20"
          >
            Previous
          </Button>
          <span className="text-xs text-white/60">
            Page {page} of {totalPages}
          </span>
          <Button
            onClick={() => void goToPage(page + 1)}
            disabled={page >= totalPages || isLoading}
            className="border border-white/20 bg-white/10 text-white hover:bg-white/20"
          >
            Next
          </Button>
        </div>
      )}
    </div>
  );
}

interface EntryProps {
  recipe: Recipe;
  isExpanded: boolean;
  onToggle: () => void;
}

function RecipeEntry({ recipe, isExpanded, onToggle }: EntryProps) {
  const panelId = `recipe-panel-${recipe.id}`;
  // approveRecipe joins the AI's string[] with "\n" into a single TEXT column; this is
  // the matching split on the read side.
  const steps = recipe.instructions.split("\n").filter((step) => step.trim() !== "");

  return (
    <li className="rounded-xl border border-white/10 bg-white/5">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isExpanded}
        aria-controls={panelId}
        className="flex w-full items-center justify-between px-4 py-3 text-left"
      >
        <span className="text-sm font-medium text-white">{recipe.title}</span>
        <span className="flex items-center gap-3">
          <span className="text-xs text-white/60">{formatDate(recipe.created_at)}</span>
          <ChevronDown className={`size-4 text-white/40 transition-transform ${isExpanded ? "rotate-180" : ""}`} />
        </span>
      </button>

      {isExpanded && (
        <div id={panelId} className="space-y-4 border-t border-white/10 px-4 py-3">
          <div>
            <h3 className="mb-1 text-xs font-semibold tracking-wide text-white/70 uppercase">Ingredients</h3>
            <ul className="list-disc space-y-1 pl-5 text-sm text-white/80">
              {recipe.ingredients.map((ingredient, i) => (
                <li key={i}>{ingredient}</li>
              ))}
            </ul>
          </div>

          <div>
            <h3 className="mb-1 text-xs font-semibold tracking-wide text-white/70 uppercase">Steps</h3>
            <ol className="list-decimal space-y-1 pl-5 text-sm text-white/80">
              {steps.map((step, i) => (
                <li key={i}>{step}</li>
              ))}
            </ol>
          </div>

          {/* consumed_products is legitimately empty when the used products vanished
              between generation and approval — omit the whole block, never a bare label. */}
          {recipe.consumed_products.length > 0 && (
            <div>
              <h3 className="mb-1 text-xs font-semibold tracking-wide text-white/70 uppercase">Used</h3>
              <p className="text-sm text-white/80">{recipe.consumed_products.map((p) => p.name).join(", ")}</p>
            </div>
          )}
        </div>
      )}
    </li>
  );
}
