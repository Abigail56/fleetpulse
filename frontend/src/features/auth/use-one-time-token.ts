"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

/** Takes a token from the URL and removes it, keeping it out of history and shared links. */
export function useOneTimeToken() {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const [token] = useState(() => searchParams.get("token"));

  useEffect(() => {
    if (window.location.search.includes("token=")) {
      window.history.replaceState(null, "", pathname);
    }
  }, [pathname]);

  return token;
}
