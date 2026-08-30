import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";

interface SubmitButtonProps {
  pendingText: string;
  children: ReactNode;
}

export function SubmitButton({ pendingText, children }: SubmitButtonProps) {
  const { pending } = useFormStatus();

  return (
    <Button
      type="submit"
      disabled={pending}
      className="bg-brand-green hover:bg-brand-green/90 h-11 w-full rounded-lg px-4 font-medium text-white transition-colors"
    >
      {pending ? (
        <span className="flex items-center gap-2">
          <span className="size-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
          {pendingText}
        </span>
      ) : (
        <span className="flex items-center gap-2">{children}</span>
      )}
    </Button>
  );
}
