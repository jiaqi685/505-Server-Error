import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";

type ShowToast = (message: string) => void;
const ToastContext = createContext<ShowToast>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState<string | null>(null);
  const [key, setKey] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback<ShowToast>((msg) => {
    setMessage(msg);
    setKey((k) => k + 1);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setMessage(null), 4100);
  }, []);

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div aria-live="polite">
        {message && (
          <div key={key} className="toast" role="status" data-testid="status-toast">
            {message}
          </div>
        )}
      </div>
    </ToastContext.Provider>
  );
}

export function useNotify(): ShowToast {
  return useContext(ToastContext);
}
