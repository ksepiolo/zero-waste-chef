import { useState } from "react";
import type { ProductWithRisk } from "@/types";
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
import { Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useRecipeGeneration } from "@/components/hooks/use-recipe-generation";

interface Props {
  initialProducts: ProductWithRisk[];
}

export function InventoryPanel({ initialProducts }: Props) {
  const [products, setProducts] = useState<ProductWithRisk[]>(initialProducts);
  const [addError, setAddError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  const { isGenerating, isApproving, recipe, generate, approve, reset } = useRecipeGeneration({
    onApproveSuccess: (usedIds) => {
      setProducts((prev) => prev.filter((p) => !usedIds.includes(p.id)));
    },
  });

  const today = new Date().toISOString().split("T")[0];

  async function handleGenerate() {
    try {
      await generate();
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
    <div className="space-y-8">
      <div className="rounded-xl border border-white/10 bg-white/5 p-6">
        <h2 className="mb-4 text-lg font-semibold text-white">Add product</h2>
        <form onSubmit={(e) => void handleAdd(e)} className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex flex-1 flex-col gap-1">
            <label htmlFor="name" className="text-xs text-white/70">
              Product name
            </label>
            <input
              id="name"
              name="name"
              type="text"
              placeholder="e.g. Milk"
              required
              className="rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-sm text-white placeholder-white/40 focus:border-white/40 focus:outline-none"
              onChange={() => {
                setAddError(null);
              }}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="expiry_date" className="text-xs text-white/70">
              Expiry date
            </label>
            <input
              id="expiry_date"
              name="expiry_date"
              type="date"
              min={today}
              required
              className="rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-sm text-white focus:border-white/40 focus:outline-none"
              onChange={() => {
                setAddError(null);
              }}
            />
          </div>
          <Button
            type="submit"
            disabled={isSubmitting}
            className="border border-white/20 bg-white/10 text-white hover:bg-white/20"
          >
            {isSubmitting ? "Adding…" : "Add"}
          </Button>
        </form>
        {addError && <p className="mt-2 text-sm text-red-300">{addError}</p>}
      </div>

      <div>
        {deleteError && <p className="mb-3 text-sm text-red-300">{deleteError}</p>}
        {products.length === 0 ? (
          <p className="text-sm text-white/50">No products yet — add one above</p>
        ) : (
          <ul className="space-y-2">
            {products.map((product) => (
              <li
                key={product.id}
                className="flex items-center justify-between rounded-xl border border-white/10 bg-white/5 px-4 py-3"
              >
                <div className="flex items-center gap-3">
                  <span className="text-sm font-medium text-white">{product.name}</span>
                  {product.is_at_risk && (
                    <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">At risk</span>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-white/60">{product.expiry_date}</span>
                  <button
                    type="button"
                    aria-label={`Delete ${product.name}`}
                    onClick={() => {
                      setDeleteError(null);
                      setPendingDeleteId(product.id);
                    }}
                    className="rounded p-1 text-white/40 transition-colors hover:bg-white/10 hover:text-red-300"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}

        {products.some((p) => p.is_at_risk) && (
          <Button
            onClick={() => void handleGenerate()}
            disabled={isGenerating || isApproving}
            className="mt-4 w-full bg-gradient-to-r from-blue-500 to-purple-500 text-white hover:opacity-90"
          >
            {isGenerating ? (
              <>
                <Loader2 className="mr-2 size-4 animate-spin" />
                Generating…
              </>
            ) : (
              "Generate Recipe"
            )}
          </Button>
        )}
      </div>

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
