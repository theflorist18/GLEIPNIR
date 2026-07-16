import { createContext, useContext, useState, type ReactNode } from 'react';
import type { Variant } from './types';

// App-level display settings (M14: trimmed to `variant` only — the token and
// the GatewayClient moved into auth/AuthContext). `variant` mirrors the
// gateway's active VARIANT for display/verify-badge purposes; the real routing
// variant lives server-side.

interface Settings {
  variant: Variant;
  setVariant: (v: Variant) => void;
}

const SettingsContext = createContext<Settings | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [variant, setVariant] = useState<Variant>('standard');
  return <SettingsContext.Provider value={{ variant, setVariant }}>{children}</SettingsContext.Provider>;
}

export function useSettings(): Settings {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettings must be used within a SettingsProvider');
  return ctx;
}
