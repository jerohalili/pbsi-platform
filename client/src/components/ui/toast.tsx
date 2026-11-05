import * as React from 'react';
import { createPortal } from 'react-dom';

type Toast = {
  id: string;
  title?: string;
  description?: string;
  variant?: 'default' | 'destructive' | 'success';
};

const TOAST_LIMIT = 5;
const TOAST_REMOVE_DELAY = 4000;

type State = {
  toasts: Toast[];
};

let count = 0;
function genId() {
  count = (count + 1) % Number.MAX_SAFE_INTEGER;
  return count.toString();
}

const listeners: Array<(state: State) => void> = [];

let memoryState: State = { toasts: [] };

function dispatch() {
  listeners.forEach((listener) => listener(memoryState));
}

// The state is replaced, never changed in place: React only re-renders when it is handed a new
// object, so mutating the old one (as this used to) meant no toast was ever drawn.
function addToToast(toast: Omit<Toast, 'id'>) {
  const id = genId();
  const newToast: Toast = { id, ...toast };
  // Keep the newest few; the oldest make room.
  memoryState = { toasts: [...memoryState.toasts, newToast].slice(-TOAST_LIMIT) };
  dispatch();
  return id;
}

function dismiss(toastId: string) {
  memoryState = { toasts: memoryState.toasts.filter((t) => t.id !== toastId) };
  dispatch();
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = React.useState<State>(memoryState);

  React.useEffect(() => {
    listeners.push(setState);
    return () => {
      const idx = listeners.indexOf(setState);
      if (idx > -1) listeners.splice(idx, 1);
    };
  }, []);

  return createPortal(
    <div className="fixed bottom-0 right-0 z-[100] flex flex-col gap-2 p-4 pointer-events-none">
      {state.toasts.map((toast) => (
        <ToastContent key={toast.id} toast={toast} onDismiss={() => dismiss(toast.id)} />
      ))}
      {children}
    </div>,
    document.body,
  );
}

function ToastContent({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const variants: Record<string, string> = {
    default: 'bg-background border text-foreground',
    destructive: 'border-destructive bg-destructive text-destructive-foreground',
    success: 'border-green-500 bg-green-500/10 text-green-700',
  };

  // Removed from the list when it has been shown long enough (it used to only be hidden, so the
  // list filled up with expired toasts).
  React.useEffect(() => {
    const timer = setTimeout(onDismiss, TOAST_REMOVE_DELAY);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const variantClass = variants[toast.variant ?? 'default'] ?? variants.default;

  return (
    <div
      className={`pointer-events-auto w-full max-w-xs rounded-lg border p-4 shadow-lg animate-in fade-in slide-in-from-right-2 ${variantClass}`}
    >
      <div className="flex items-start gap-3">
        {toast.variant === 'destructive' && (
          <div className="w-6 h-6 rounded-full bg-destructive flex items-center justify-center text-destructive-foreground text-xs">!</div>
        )}
        {toast.variant === 'success' && (
          <div className="w-6 h-6 rounded-full bg-green-500 flex items-center justify-center text-white text-xs">✓</div>
        )}
        <div className="text-sm font-medium">{toast.title}</div>
        {toast.description && (
          <div className="text-xs text-muted-foreground mt-0.5">{toast.description}</div>
        )}
        <button
          onClick={onDismiss}
          className="ml-auto opacity-50 hover:opacity-100"
          aria-label="Dismiss"
        >
          ✕
        </button>
      </div>
    </div>
  );
}

// One function for the whole app. It must never change between renders: pages list `toast` in
// the dependencies of useCallback/useEffect, and a new function every render made the
// Notifications page reload itself endlessly (hundreds of requests, stuck on the skeleton).
const toast = (options: Omit<Toast, 'id'>) => {
  addToToast(options);
};

export function useToast() {
  return { toast };
}
