import { useState } from "react";
import type { ProductWithRisk, RecipeMethod, RecipeParams, RecipeTechnique, RecipeTime } from "@/types";
import { DEFAULT_RECIPE_PARAMS, RECIPE_METHODS, RECIPE_TECHNIQUES, RECIPE_TIMES } from "@/types";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ChevronDown, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useRecipeGeneration } from "@/components/hooks/use-recipe-generation";

interface Props {
  initialProducts: ProductWithRisk[];
}

// Matches the add-product inputs above — src/components/ui/ has no Select component,
// and this form is native inputs with inline Tailwind throughout. appearance-none +
// the absolutely positioned ChevronDown below reproduces the Figma bordered-box-with-
// chevron look, since native <select> arrows aren't stylable.
const selectClasses =
  "w-full appearance-none rounded-lg border border-brand-input-border bg-white px-3 py-2 pr-9 text-sm text-brand-ink focus:border-brand-green focus:outline-none disabled:cursor-not-allowed disabled:opacity-50";

// Display copy for the three selects — a view-layer concern, so it lives with the view;
// src/types.ts stays entities and DTOs. Keyed by the enum, so adding a token there fails to
// compile until it has a label here.
const RECIPE_TECHNIQUE_LABELS: Record<RecipeTechnique, string> = {
  any: "Any",
  saute: "Sauté",
  roast: "Roast",
  bake: "Bake",
  "boil-simmer": "Boil / simmer",
  "stir-fry": "Stir-fry",
  fry: "Fry",
  "no-cook": "No-cook",
};

const RECIPE_METHOD_LABELS: Record<RecipeMethod, string> = {
  any: "Any",
  "one-pot": "One-pot",
  "sheet-pan": "Sheet-pan",
  "salad-assembly": "Salad / assembly",
  soup: "Soup",
};

// "~" not "≤": the prompt states the cap as a hard rule, but manual verification (plan.md
// § 2.9) found the model overruns it in roughly half of `15` generations — it puts "Quick" in
// the title and then simmers raw rice. There is deliberately no server-side check that a
// parameter was honoured, so the label must not promise a bound nothing enforces.
const RECIPE_TIME_LABELS: Record<RecipeTime, string> = {
  any: "Any",
  "15": "~15 min",
  "30": "~30 min",
  "45": "~45 min",
};

export function InventoryPanel({ initialProducts }: Props) {
  const [products, setProducts] = useState<ProductWithRisk[]>(initialProducts);
  const [addError, setAddError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  // Session-only by decision: no localStorage, no preferences table. A reload resets to Any.
  const [params, setParams] = useState<RecipeParams>(DEFAULT_RECIPE_PARAMS);

  const { isGenerating, isApproving, recipe, generate, approve, reset } = useRecipeGeneration({
    onApproveSuccess: (deletedIds, skippedIds) => {
      // Resolve names before filtering — a skipped product was already removed
      // server-side (in another tab), but this tab's stale state still has its name.
      if (skippedIds.length > 0) {
        const skippedNames = products.filter((p) => skippedIds.includes(p.id)).map((p) => p.name);
        toast.info(`Already removed elsewhere: ${skippedNames.join(", ")}`);
      }
      setProducts((prev) => prev.filter((p) => !deletedIds.includes(p.id)));
    },
    // Named, not counted: "1 product was skipped" leaves the user checking the list to find
    // out which. The hook only calls this when something was actually held back.
    onExpiredExcluded: (excluded) => {
      toast.info(`Skipped expired: ${excluded.map((p) => p.name).join(", ")}`);
    },
  });

  const today = new Date().toISOString().split("T")[0];

  async function handleGenerate() {
    try {
      await generate(params);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to generate recipe");
    }
  }

  async function handleApprove() {
    try {
      await approve();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save recipe");
    }
  }

  async function handleAdd(e: { preventDefault(): void; currentTarget: HTMLFormElement }) {
    e.preventDefault();
    setAddError(null);
    setIsSubmitting(true);

    const form = e.currentTarget;
    const formData = new FormData(form);
    const name = formData.get("name") as string;
    const expiry_date = formData.get("expiry_date") as string;

    try {
      const res = await fetch("/api/products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, expiry_date }),
      });

      if (!res.ok) {
        const json = (await res.json()) as { error?: string };
        setAddError(json.error ?? "Failed to add product");
        return;
      }

      const json = (await res.json()) as { product: ProductWithRisk };
      setProducts((prev) => [...prev, json.product].sort((a, b) => a.expiry_date.localeCompare(b.expiry_date)));
      form.reset();
    } catch {
      setAddError("Network error. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleConfirmDelete() {
    if (!pendingDeleteId) return;
    setDeleteError(null);

    const id = pendingDeleteId;
    setPendingDeleteId(null);

    try {
      const res = await fetch(`/api/products/${id}`, { method: "DELETE" });

      if (!res.ok) {
        const json = (await res.json()) as { error?: string };
        setDeleteError(json.error ?? "Failed to delete product");
        return;
      }

      setProducts((prev) => prev.filter((p) => p.id !== id));
    } catch {
      setDeleteError("Network error. Please try again.");
    }
  }

  const pendingDeleteProduct = products.find((p) => p.id === pendingDeleteId);

  return (
    <div className="grid gap-6 sm:grid-cols-5">
      <div className="border-brand-border rounded-[20px] border bg-white p-6 sm:col-span-3">
        <h2 className="font-display text-brand-ink mb-4 text-lg">Produkty</h2>

        <div className="mb-4">
          <p className="font-body text-brand-muted mb-2 text-xs font-medium">Nowy produkt</p>
          <form onSubmit={(e) => void handleAdd(e)} className="flex items-center gap-2">
            <label htmlFor="name" className="sr-only">
              Product name
            </label>
            <input
              id="name"
              name="name"
              type="text"
              placeholder="Nazwa produktu"
              required
              className="border-brand-input-border placeholder-brand-muted-2 text-brand-ink focus:border-brand-green flex-1 rounded-lg border px-3 py-2 text-sm focus:outline-none"
              onChange={() => {
                setAddError(null);
              }}
            />
            <label htmlFor="expiry_date" className="sr-only">
              Expiry date
            </label>
            <input
              id="expiry_date"
              name="expiry_date"
              type="date"
              min={today}
              required
              className="border-brand-input-border text-brand-ink focus:border-brand-green rounded-lg border px-3 py-2 text-sm focus:outline-none"
              onChange={() => {
                setAddError(null);
              }}
            />
            <Button
              type="submit"
              disabled={isSubmitting}
              aria-label="Add product"
              className="bg-brand-green hover:bg-brand-green/90 flex size-9 shrink-0 items-center justify-center rounded-full p-0 text-white"
            >
              {isSubmitting ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
            </Button>
          </form>
          {addError && <p className="text-brand-danger mt-2 text-sm">{addError}</p>}
        </div>

        <div>
          {deleteError && <p className="text-brand-danger mb-3 text-sm">{deleteError}</p>}
          {products.length === 0 ? (
            <p className="text-brand-muted text-sm">No products yet — add one above</p>
          ) : (
            <ul className="space-y-2">
              {products.map((product) => {
                const [year, month, day] = product.expiry_date.split("-");
                return (
                  <li
                    key={product.id}
                    className="bg-brand-surface flex items-center justify-between rounded-[20px] px-4 py-3"
                  >
                    <div className="flex items-center gap-3">
                      <div>
                        <p className="text-brand-ink text-sm font-medium">{product.name}</p>
                        <p className="text-brand-muted text-xs">{`Exp. date: ${day}.${month}.${year}`}</p>
                      </div>
                      {product.is_at_risk && (
                        <span className="bg-brand-warn-bg text-brand-warn border-brand-warn-border rounded border px-2 py-0.5 text-xs font-medium">
                          At risk
                        </span>
                      )}
                      {/* Mutually exclusive with "At risk" by construction (classifyExpiry derives
                          both from one call), so no precedence logic. Danger rather than warn: this
                          one is not a deadline to cook towards, it is stock that is already gone. */}
                      {product.is_expired && (
                        <span className="bg-brand-danger-bg text-brand-danger border-brand-danger-border rounded border px-2 py-0.5 text-xs font-medium">
                          Expired
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      <span aria-hidden="true" className="text-brand-muted-2 p-1">
                        <Pencil className="size-4" />
                      </span>
                      <button
                        type="button"
                        aria-label={`Delete ${product.name}`}
                        onClick={() => {
                          setDeleteError(null);
                          setPendingDeleteId(product.id);
                        }}
                        className="text-brand-muted-2 hover:text-brand-danger rounded p-1 transition-colors"
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      {products.length > 0 && (
        <div className="bg-brand-surface rounded-[20px] p-6 sm:col-span-2">
          <h2 className="font-display text-brand-ink mb-4 text-lg">Ustawienia przepisu</h2>
          <div className="space-y-3">
            <div>
              <label htmlFor="recipe-technique" className="text-brand-muted mb-1 block text-xs">
                Technique
              </label>
              <div className="relative">
                <select
                  id="recipe-technique"
                  value={params.technique}
                  disabled={isGenerating || isApproving}
                  onChange={(e) => {
                    setParams((prev) => ({ ...prev, technique: e.target.value as RecipeTechnique }));
                  }}
                  className={selectClasses}
                >
                  {RECIPE_TECHNIQUES.map((value) => (
                    <option key={value} value={value}>
                      {RECIPE_TECHNIQUE_LABELS[value]}
                    </option>
                  ))}
                </select>
                <ChevronDown className="text-brand-muted pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2" />
              </div>
            </div>
            <div>
              <label htmlFor="recipe-method" className="text-brand-muted mb-1 block text-xs">
                Method
              </label>
              <div className="relative">
                <select
                  id="recipe-method"
                  value={params.method}
                  disabled={isGenerating || isApproving}
                  onChange={(e) => {
                    setParams((prev) => ({ ...prev, method: e.target.value as RecipeMethod }));
                  }}
                  className={selectClasses}
                >
                  {RECIPE_METHODS.map((value) => (
                    <option key={value} value={value}>
                      {RECIPE_METHOD_LABELS[value]}
                    </option>
                  ))}
                </select>
                <ChevronDown className="text-brand-muted pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2" />
              </div>
            </div>
            <div>
              <label htmlFor="recipe-time" className="text-brand-muted mb-1 block text-xs">
                Time preference
              </label>
              <div className="relative">
                <select
                  id="recipe-time"
                  value={params.time}
                  disabled={isGenerating || isApproving}
                  onChange={(e) => {
                    setParams((prev) => ({ ...prev, time: e.target.value as RecipeTime }));
                  }}
                  className={selectClasses}
                >
                  {RECIPE_TIMES.map((value) => (
                    <option key={value} value={value}>
                      {RECIPE_TIME_LABELS[value]}
                    </option>
                  ))}
                </select>
                <ChevronDown className="text-brand-muted pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2" />
              </div>
            </div>

            <p className="text-brand-muted text-xs">
              These guide the AI — it aims for them, but does not always hit them.
            </p>

            <Button
              onClick={() => void handleGenerate()}
              disabled={isGenerating || isApproving}
              className="bg-brand-green hover:bg-brand-green/90 w-full text-white"
            >
              {isGenerating ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" />
                  Generating…
                </>
              ) : (
                "Generate"
              )}
            </Button>
          </div>
        </div>
      )}

      <AlertDialog
        open={pendingDeleteId !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDeleteId(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete product?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete <span className="font-semibold">{pendingDeleteProduct?.name}</span>? This
              cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void handleConfirmDelete()}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={recipe !== null}
        onOpenChange={(open) => {
          if (!open) reset();
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{recipe?.title}</AlertDialogTitle>
          </AlertDialogHeader>

          <div className="max-h-[50vh] space-y-3 overflow-y-auto">
            <ul className="list-disc space-y-1 pl-5 text-sm">
              {recipe?.ingredients.map((ingredient, i) => (
                <li key={i}>{ingredient}</li>
              ))}
            </ul>
            <ol className="list-decimal space-y-1 pl-5 text-sm">
              {recipe?.instructions.map((step, i) => (
                <li key={i}>{step}</li>
              ))}
            </ol>
          </div>

          <AlertDialogDescription>
            Will remove from inventory:{" "}
            {products
              .filter((p) => recipe?.used_product_ids.includes(p.id))
              .map((p) => p.name)
              .join(", ")}
          </AlertDialogDescription>

          <AlertDialogFooter>
            <AlertDialogCancel onClick={reset}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void handleGenerate()} disabled={isGenerating || isApproving}>
              Generate Different Recipe
            </AlertDialogAction>
            <Button onClick={() => void handleApprove()} disabled={isApproving}>
              {isApproving ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" />
                  Approving…
                </>
              ) : (
                "Approve"
              )}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
