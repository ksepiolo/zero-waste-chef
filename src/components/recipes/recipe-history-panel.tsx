import { useRef, useState } from "react";
import type { Recipe, RecipePage } from "@/types";
import { RECIPES_PAGE_SIZE } from "@/types";
import { Dialog } from "radix-ui";
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
  const [openId, setOpenId] = useState<string | null>(null);
  // isLoading drives the UI; this mirrors it synchronously so two clicks landing in the
  // same frame — before the re-render — still cannot start two overlapping fetches.
  const inFlight = useRef(false);

  const totalPages = Math.max(1, Math.ceil(pageData.total / RECIPES_PAGE_SIZE));
  // The `page > 1` arm keeps the controls mounted when the total has shrunk below a single
  // page while the user sits on a later one — otherwise that page renders empty with the
  // pagination block gone and no way back. Unreachable while rows can only be added, but
  // this gate is what would stop holding the moment they can be removed.
  const showPagination = pageData.total > RECIPES_PAGE_SIZE || page > 1;

  async function goToPage(next: number) {
    // The pagination buttons stay focusable at the range edges (aria-disabled, not
    // disabled), so out-of-range and in-flight clicks are rejected here instead.
    if (inFlight.current || next < 1 || next > totalPages) return;
    inFlight.current = true;
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
      // The open dialog's recipe is gone from the DOM after a page turn; drop the reference.
      setOpenId(null);
    } catch {
      toast.error("Network error. Please try again.");
    } finally {
      inFlight.current = false;
      setIsLoading(false);
    }
  }

  if (loadError) {
    return <p className="text-brand-danger text-sm">Couldn&apos;t load your recipes — refresh to try again</p>;
  }

  return (
    <div className="space-y-6">
      {/* Live region so a page turn is announced: the container must be in the DOM before
          its contents swap, which is why it wraps both branches rather than the grid only. */}
      <div aria-live="polite" aria-busy={isLoading}>
        {pageData.recipes.length === 0 ? (
          // Kept inside the shell rather than an early return: a page that has gone empty
          // because rows were removed still needs its Previous button to get back.
          <p className="text-brand-muted text-sm">
            {page === 1
              ? "No recipes yet — approved recipes will appear here"
              : "Nothing on this page — use Previous to get back to your recipes"}
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            {pageData.recipes.map((recipe) => (
              <RecipeCard
                key={recipe.id}
                recipe={recipe}
                isOpen={openId === recipe.id}
                onOpenChange={(open) => {
                  setOpenId(open ? recipe.id : null);
                }}
              />
            ))}
          </div>
        )}
      </div>

      {showPagination && (
        <div className="flex items-center justify-between">
          <button
            type="button"
            // Clamped, not just `page - 1`: if the total shrank while the user sat on a far
            // page, every page between here and totalPages is also gone, and goToPage
            // rejects an out-of-range target — so step straight back to the last real page.
            onClick={() => void goToPage(Math.min(page - 1, totalPages))}
            aria-disabled={page <= 1 || isLoading}
            className="border-brand-border text-brand-ink hover:bg-brand-surface rounded-lg border bg-white px-4 py-2 text-sm font-medium aria-disabled:pointer-events-none aria-disabled:opacity-50"
          >
            Previous
          </button>
          <span className="text-brand-muted text-xs">
            Page {page} of {totalPages}
          </span>
          <button
            type="button"
            onClick={() => void goToPage(page + 1)}
            aria-disabled={page >= totalPages || isLoading}
            className="border-brand-border text-brand-ink hover:bg-brand-surface rounded-lg border bg-white px-4 py-2 text-sm font-medium aria-disabled:pointer-events-none aria-disabled:opacity-50"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}

interface CardProps {
  recipe: Recipe;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}

function RecipeCard({ recipe, isOpen, onOpenChange }: CardProps) {
  // approveRecipe joins the AI's string[] with "\n" into a single TEXT column; this is
  // the matching split on the read side.
  const steps = recipe.instructions.split("\n").filter((step) => step.trim() !== "");

  return (
    <Dialog.Root open={isOpen} onOpenChange={onOpenChange}>
      <div className="border-brand-border relative h-[264px] overflow-hidden rounded-[20px] border bg-white">
        <Dialog.Trigger asChild>
          <button type="button" className="h-full w-full p-5 text-left">
            <h3 className="font-display text-brand-ink text-xl">{recipe.title}</h3>
            <p className="font-body text-brand-muted text-sm">{formatDate(recipe.created_at)}</p>
            <p className="font-body text-brand-muted mt-3 text-sm font-medium">Ingredients</p>
            <p className="font-body text-brand-ink line-clamp-5 text-base">{recipe.ingredients.join(", ")}</p>
          </button>
        </Dialog.Trigger>
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 bottom-0 h-14 rounded-b-[20px] bg-gradient-to-t from-white via-white/80 to-transparent"
        />
      </div>

      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40" />
        <Dialog.Content className="border-brand-border fixed top-1/2 left-1/2 max-h-[80vh] w-full max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border bg-white p-6">
          <Dialog.Title className="font-display text-brand-ink text-xl">{recipe.title}</Dialog.Title>
          <p className="font-body text-brand-muted mt-1 text-sm">{formatDate(recipe.created_at)}</p>

          <div className="mt-4 space-y-4">
            <div>
              <h4 className="text-brand-muted mb-1 text-xs font-semibold tracking-wide uppercase">Ingredients</h4>
              <ul className="text-brand-ink list-disc space-y-1 pl-5 text-sm">
                {recipe.ingredients.map((ingredient, i) => (
                  <li key={i}>{ingredient}</li>
                ))}
              </ul>
            </div>

            <div>
              <h4 className="text-brand-muted mb-1 text-xs font-semibold tracking-wide uppercase">Steps</h4>
              <ol className="text-brand-ink list-decimal space-y-1 pl-5 text-sm">
                {steps.map((step, i) => (
                  <li key={i}>{step}</li>
                ))}
              </ol>
            </div>

            {/* consumed_products is legitimately empty when the used products vanished
                between generation and approval — omit the whole block, never a bare label. */}
            {recipe.consumed_products.length > 0 && (
              <div>
                <h4 className="text-brand-muted mb-1 text-xs font-semibold tracking-wide uppercase">Used</h4>
                <p className="text-brand-ink text-sm">{recipe.consumed_products.map((p) => p.name).join(", ")}</p>
              </div>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
