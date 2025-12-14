import { X, AlertTriangle } from 'lucide-react';

interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  variant?: 'danger' | 'warning' | 'default';
}

export default function ConfirmDialog({
  isOpen,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  onConfirm,
  onCancel,
  variant = 'default',
}: ConfirmDialogProps) {
  if (!isOpen) return null;

  const variantStyles = {
    danger: {
      confirm: 'bg-red-500 hover:bg-red-600 text-white',
      icon: 'text-red-400',
      border: 'border-red-500/20',
      bg: 'bg-red-500/10',
    },
    warning: {
      confirm: 'bg-amber-500 hover:bg-amber-600 text-white',
      icon: 'text-amber-400',
      border: 'border-amber-500/20',
      bg: 'bg-amber-500/10',
    },
    default: {
      confirm: 'bg-indigo-600 hover:bg-indigo-500 text-white',
      icon: 'text-indigo-400',
      border: 'border-indigo-500/20',
      bg: 'bg-indigo-500/10',
    },
  };

  const styles = variantStyles[variant];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="glass-panel rounded-2xl w-full max-w-md border border-zinc-800 overflow-hidden shadow-2xl animate-fadeIn">
        <div className="px-6 py-4 border-b border-zinc-800 flex items-center justify-between bg-zinc-900/50">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-lg ${styles.border} ${styles.bg} flex items-center justify-center`}>
              <AlertTriangle size={20} className={styles.icon} />
            </div>
            <h3 className="text-lg font-semibold text-white">{title}</h3>
          </div>
          <button
            onClick={onCancel}
            className="p-1.5 rounded-lg hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition-colors"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        <div className="px-6 py-5">
          <p className="text-zinc-300 leading-relaxed">{message}</p>
        </div>

        <div className="px-6 py-4 border-t border-zinc-800 bg-zinc-900/30 flex items-center justify-end gap-3">
          <button
            onClick={onCancel}
            className="px-4 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700 transition-colors font-medium"
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            className={`px-4 py-2 rounded-lg ${styles.confirm} font-semibold shadow-lg transition-all`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
