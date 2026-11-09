import type { ReactNode } from "react";

interface BadgeProps {
  children: ReactNode;
  variant?: "primary" | "accent" | "success" | "danger" | "neutral";
  size?: "sm" | "md";
  className?: string;
}

export function Badge({ children, variant = "neutral", size = "sm", className = "" }: BadgeProps) {
  const variants = {
    primary: "bg-primary/10 text-club-text",
    accent: "bg-secondary text-secondary-foreground",
    success: "bg-emerald-500/10 text-emerald-400",
    danger: "bg-red-500/10 text-red-400",
    neutral: "bg-muted text-muted-foreground",
  };

  const sizes = {
    sm: "px-2 py-0.5 text-xs",
    md: "px-3 py-1 text-sm",
  };

  return (
    <span
      className={`inline-flex items-center font-bold font-heading uppercase tracking-wider rounded-md ${variants[variant]} ${sizes[size]} ${className}`}
    >
      {children}
    </span>
  );
}
