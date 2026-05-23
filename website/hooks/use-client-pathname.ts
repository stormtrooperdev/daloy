'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

/**
 * Returns the current browser pathname, gated by a `mounted` flag so it's
 * always `null` during prerender and on the very first client render.
 *
 * This is the recommended workaround from the Next.js docs for apps that use
 * rewrites in `next.config` or `Proxy`. With rewrites, the prerendered HTML
 * is built for the source pathname, but the browser URL may differ — so
 * `usePathname()` on first paint can return the wrong value.
 *
 * Reference: https://nextjs.org/docs/app/api-reference/functions/use-pathname#avoid-hydration-mismatch-with-rewrites
 */
export function useClientPathname(): string | null {
  const pathname = usePathname();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

  return mounted ? pathname : null;
}
