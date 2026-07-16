import { useState } from 'react';
import { GatewayError } from '../api';

// Inline-error helper promoted verbatim from demo.tsx (M14): run() clears the
// message, awaits the action, and formats a GatewayError as "status: body".
export function useErr() {
  const [msg, setMsg] = useState<string>('');
  const run = async (fn: () => Promise<void>) => {
    setMsg('');
    try {
      await fn();
    } catch (e) {
      if (e instanceof GatewayError) setMsg(`${e.status}: ${e.body || e.message}`);
      else setMsg(String(e));
    }
  };
  return { msg, run };
}
