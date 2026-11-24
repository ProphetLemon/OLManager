import type { ReactNode, JSX } from "react";
import { X } from "lucide-react";

interface ModalProps {
  children: ReactNode;
  open: boolean;
  onClose?: () => void;
  title?: string;
  maxWidth?: "sm" | "md" | "lg" | "xl";
}

const maxWidthClasses = {
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-lg",
  xl: "max-w-xl",
};

export function Modal({
  children,
  open,
  onClose,
  title,
  maxWidth = "md",
}: ModalProps): JSX.Element | null {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div
        className={`mx-4 max-h-[90vh] w-full overflow-y-auto rounded-2xl border border-gray-200 bg-white p-6 shadow-2xl dark:border-navy-600 dark:bg-navy-800 animate-scale-in ${maxWidthClasses[maxWidth]}`}
      >
        {title && (
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-lg font-heading font-bold uppercase tracking-wide text-gray-900 dark:text-white">
              {title}
            </h3>
            {onClose && (
              <button
                type="button"
                onClick={onClose}
                className="text-gray-400 hover:text-gray-700 dark:hover:text-white transition-colors p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-navy-600"
              >
                <X className="w-5 h-5" />
              </button>
            )}
          </div>
        )}
        {children}
      </div>
    </div>
  );
}
