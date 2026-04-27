import React, { createContext, useContext } from 'react';

export type ToastType = 'success' | 'error' | 'info';
export type ToastState = { message: string; type: ToastType } | null;

export const ToastContext = createContext<{ showToast: (message: string, type?: ToastType) => void }>({ showToast: () => {} });
export const useToast = () => useContext(ToastContext);

export const ToastProvider: React.FC<{
  showToast: (message: string, type?: ToastType) => void;
  children: React.ReactNode;
}> = ({ showToast, children }) => (
  <ToastContext.Provider value={{ showToast }}>{children}</ToastContext.Provider>
);

