import { DropdownMenu } from "radix-ui";
import { ChevronDown } from "lucide-react";
import { toast } from "sonner";

interface Props {
  email: string;
}

export function UserMenu({ email }: Props) {
  async function handleSignOut() {
    try {
      const res = await fetch("/api/auth/signout", { method: "POST" });
      if (!res.ok) {
        toast.error("Failed to sign out. Please try again.");
        return;
      }
      window.location.href = "/";
    } catch {
      toast.error("Network error. Please try again.");
    }
  }

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button type="button" className="flex items-center gap-2 rounded-full focus:outline-none">
          <span className="bg-brand-surface text-brand-ink flex h-9 w-9 items-center justify-center rounded-full">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M17 21a1 1 0 0 0 1-1v-5.35c0-.457.316-.844.727-1.041a4 4 0 0 0-2.134-7.589 5 5 0 0 0-9.186 0 4 4 0 0 0-2.134 7.588c.411.198.727.585.727 1.041V20a1 1 0 0 0 1 1Z" />
              <path d="M6 17h12" />
            </svg>
          </span>
          <span className="font-body text-brand-ink text-sm">{email}</span>
          <ChevronDown className="text-brand-muted size-4" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={8}
          className="border-brand-border min-w-[160px] rounded-lg border bg-white p-1 shadow-md"
        >
          <DropdownMenu.Item
            onSelect={() => void handleSignOut()}
            className="text-brand-ink hover:bg-brand-surface focus:bg-brand-surface cursor-pointer rounded-md px-3 py-2 text-sm outline-none"
          >
            Sign out
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
