import { CircleCheckIcon, InfoIcon, Loader2Icon, OctagonXIcon, TriangleAlertIcon } from "lucide-react";
import { Toaster as Sonner, type ToasterProps } from "sonner";

// shadcn's template reads the theme from next-themes, which assumes a Next.js app wrapping
// everything in a ThemeProvider. This app has none — `useTheme()` could only ever return the
// context default, so the hook was dead weight that still crashed dev SSR: the optimized
// next-themes chunk binds its own React copy, and when Vite re-optimizes deps mid-session that
// copy's hook dispatcher goes null ("Invalid hook call" at sonner.tsx). Passing "system"
// directly is what the destructuring default already produced, minus the failure mode.
const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      theme="system"
      className="toaster group"
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
        } as React.CSSProperties
      }
      {...props}
    />
  );
};

export { Toaster };
