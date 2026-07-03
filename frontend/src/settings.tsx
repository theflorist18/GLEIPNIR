import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { GatewayClient } from './api';
import type { Variant } from './types';

// App-wide settings: the bearer token, the active variant (display/context only —
// the real routing variant is set on the gateway), and a memoised GatewayClient.
interface Settings {
  token: string;
  setToken: (t: string) => void;
  variant: Variant;
  setVariant: (v: Variant) => void;
  client: GatewayClient;
}

const SettingsContext = createContext<Settings | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string>('dev-token');
  const [variant, setVariant] = useState<Variant>('standard');

  const client = useMemo(
    () => new GatewayClient({ getToken: () => token }),
    [token],
  );

  const value: Settings = { token, setToken, variant, setVariant, client };
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): Settings {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettings must be used within a SettingsProvider');
  return ctx;
}
