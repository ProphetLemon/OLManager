import { getRoleIconPath, getRoleBadgeVariant, getRoleAbbreviation } from "@/lib/players/roleIcons";

interface RoleBadgeProps {
  role: string;
  size?: "sm" | "md" | "lg";
  showLabel?: boolean;
  className?: string;
  title?: string;
}

/**
 * Reusable badge component that displays a role icon with optional label.
 * Automatically handles color coding and abbreviations.
 */
export function RoleBadge({ 
  role, 
  size = "sm", 
  showLabel = false,
  className = "",
  title
}: RoleBadgeProps) {
  // Handle empty/undefined roles gracefully
  if (!role || role.trim() === "") {
    return (
      <span
        className={`inline-flex items-center justify-center font-bold font-heading uppercase tracking-wider rounded-md bg-muted text-muted-foreground px-2 py-0.5 text-xs ${className}`}
        title="Unknown role"
      >
        ?
      </span>
    );
  }
  
  const iconPath = getRoleIconPath(role);
  
  // Use provided title or default to the full role name
  const tooltip = title ?? role;

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
    lg: "px-4 py-1.5 text-base",
  };

  // Fallback to text badge if role is not recognized
  if (!iconPath) {
    return (
      <span
        className={`inline-flex items-center justify-center font-bold font-heading uppercase tracking-wider rounded-md ${variants.neutral} ${sizes[size]} ${className}`}
        title={tooltip}
      >
        {role.toUpperCase()}
      </span>
    );
  }

  const variant = getRoleBadgeVariant(role);
  const abbreviation = getRoleAbbreviation(role);

  return (
    <span
      className={`inline-flex items-center gap-1 font-bold font-heading uppercase tracking-wider rounded-md ${variants[variant]} ${sizes[size]} ${className}`}
      title={tooltip}
    >
      <img 
        src={iconPath} 
        alt={role} 
        className={size === "sm" ? "h-3.5 w-3.5" : size === "md" ? "h-4 w-4" : "h-5 w-5"} 
        style={{ display: "block" }}
      />
      {showLabel && (
        <span className="leading-none">
          {abbreviation}
        </span>
      )}
    </span>
  );
}

