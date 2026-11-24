import { useEffect } from "react";

import { setLiveMatchActive } from "@/services/autoSave";

/** While the live match screen is up the backend holds a live session: no auto-save. */
export function useLiveMatchActive(): void {
  useEffect(() => {
    setLiveMatchActive(true);
    return () => setLiveMatchActive(false);
  }, []);
}
