import { useId, type InputHTMLAttributes, type Ref } from "react";
import { cn } from "./cn";

export interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  /** Shown under the field and announced to screen readers. */
  error?: string | undefined;
  hint?: string | undefined;
  ref?: Ref<HTMLInputElement>;
}

/** A labelled input with hint and error text wired up for assistive technology. */
export function TextField({ label, error, hint, id, className, ref, ...props }: TextFieldProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const hintId = hint ? `${inputId}-hint` : undefined;
  const errorId = error ? `${inputId}-error` : undefined;

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={inputId} className="text-ink text-sm font-medium">
        {label}
      </label>
      <input
        ref={ref}
        id={inputId}
        aria-invalid={error ? true : undefined}
        aria-describedby={[hintId, errorId].filter(Boolean).join(" ") || undefined}
        className={cn(
          // 16px text stops iOS from zooming into the field.
          "border-line bg-surface text-ink h-11 rounded-lg border px-3 text-base",
          "placeholder:text-muted/70 focus:border-accent focus:outline-accent/25 focus:outline-2",
          "disabled:bg-paper disabled:text-muted",
          error && "border-danger focus:border-danger focus:outline-danger/25",
        )}
        {...props}
      />
      {hint && !error ? (
        <p id={hintId} className="text-muted text-sm">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="text-danger text-sm">
          {error}
        </p>
      ) : null}
    </div>
  );
}
