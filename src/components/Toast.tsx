import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';

type ToastType = 'success' | 'error' | 'info';

interface Toast {
  id: number;
  type: ToastType;
  message: string;
}

interface ToastContextValue {
  toast: (message: string, type?: ToastType) => void;
}

const ToastContext = createContext<ToastContextValue>({ toast: () => {} });

export function useToast() {
  return useContext(ToastContext);
}

let nextId = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const addToast = useCallback((message: string, type: ToastType = 'info') => {
    const id = nextId++;
    setToasts(prev => [...prev, { id, type, message }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 4000);
  }, []);

  return (
    <ToastContext.Provider value={{ toast: addToast }}>
      {children}
      {/* Toast container */}
      {toasts.length > 0 && (
        <div className="fixed top-4 right-4 z-[70] space-y-2 max-w-xs">
          {toasts.map(t => (
            <div
              key={t.id}
              className={`rounded-lg px-4 py-2.5 text-sm font-medium shadow-lg border animate-in fade-in slide-in-from-right duration-200 ${
                t.type === 'error'
                  ? 'bg-red-900/90 border-red-700/50 text-red-100'
                  : t.type === 'success'
                    ? 'bg-green-900/90 border-green-700/50 text-green-100'
                    : 'bg-chess-surface border-chess-border/40 text-chess-text'
              }`}
            >
              {t.message}
            </div>
          ))}
        </div>
      )}
    </ToastContext.Provider>
  );
}
