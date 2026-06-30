"use client";

import { useCallback, useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

function normalizeSearchParams(nextInit) {
  if (nextInit instanceof URLSearchParams) return new URLSearchParams(nextInit);
  return new URLSearchParams(nextInit || "");
}

export function useMutableSearchParams() {
  const router = useRouter();
  const pathname = usePathname();
  const nextSearchParams = useSearchParams();
  const params = useMemo(
    () => new URLSearchParams(nextSearchParams?.toString() || ""),
    [nextSearchParams],
  );

  const setSearchParams = useCallback(
    (nextInit, options = {}) => {
      const nextParams = typeof nextInit === "function"
        ? nextInit(new URLSearchParams(params))
        : nextInit;
      const normalized = normalizeSearchParams(nextParams);
      const query = normalized.toString();
      const href = `${pathname || "/"}${query ? `?${query}` : ""}`;

      if (options?.replace) router.replace(href);
      else router.push(href);
    },
    [params, pathname, router],
  );

  return [params, setSearchParams];
}
