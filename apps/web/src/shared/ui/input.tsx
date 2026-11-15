import * as React from "react";
import * as LabelPrimitive from "@radix-ui/react-label";
import { cn } from "@/shared/lib/utils";

const field =
  "w-full rounded-md border border-input bg-background px-3 text-sm placeholder:text-muted-foreground disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-ring";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...p }, ref) => <input ref={ref} className={cn(field, "h-9", className)} {...p} />,
);
Input.displayName = "Input";

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...p }, ref) => <textarea ref={ref} className={cn(field, "min-h-20 py-2", className)} {...p} />,
);
Textarea.displayName = "Textarea";

export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, ...p }, ref) => <select ref={ref} className={cn(field, "h-9 pr-8", className)} {...p} />,
);
Select.displayName = "Select";

export function Label({ className, ...p }: React.ComponentPropsWithoutRef<typeof LabelPrimitive.Root>) {
  return <LabelPrimitive.Root className={cn("text-xs font-medium text-foreground", className)} {...p} />;
}

export function FieldError({ children }: { children?: React.ReactNode }) {
  if (!children) return null;
  return <p role="alert" className="text-xs text-destructive">{children}</p>;
}
