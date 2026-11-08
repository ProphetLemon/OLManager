import { useState, useEffect, useCallback } from "react";
import {
  NoPlatformBuildError,
  checkForUpdate,
  downloadAndInstallUpdate,
  UpdateInfo,
} from "../services/updaterService";
import type { DownloadEvent } from "../services/updaterService";

interface UpdaterState {
  updateAvailable: boolean;
  updateInfo: UpdateInfo | null;
  checking: boolean;
  downloading: boolean;
  progress: { percent: number; contentLength?: number } | null;
  error: string | null;
  /** The latest release has no build for this platform. */
  noPlatformBuild: boolean;
  dismissed: boolean;
}

export function useUpdater(checkOnMount = true) {
  const [state, setState] = useState<UpdaterState>({
    updateAvailable: false,
    updateInfo: null,
    checking: false,
    downloading: false,
    progress: null,
    error: null,
    noPlatformBuild: false,
    dismissed: false,
  });

  const check = useCallback(async () => {
    setState((prev) => ({ ...prev, checking: true, error: null, noPlatformBuild: false }));
    try {
      const info = await checkForUpdate();
      if (info) {
        setState((prev) => ({
          ...prev,
          updateAvailable: true,
          updateInfo: info,
          checking: false,
        }));
      } else {
        setState((prev) => ({
          ...prev,
          updateAvailable: false,
          updateInfo: null,
          checking: false,
        }));
      }
    } catch (err) {
      if (err instanceof NoPlatformBuildError) {
        setState((prev) => ({ ...prev, checking: false, noPlatformBuild: true }));
        return;
      }
      setState((prev) => ({
        ...prev,
        checking: false,
        error: err instanceof Error ? err.message : String(err),
      }));
    }
  }, []);

  const dismiss = useCallback(() => {
    setState((prev) => ({ ...prev, dismissed: true }));
  }, []);

  const install = useCallback(async () => {
    setState((prev) => ({ ...prev, downloading: true, error: null, progress: null }));
    try {
      let totalBytes = 0;
      let downloadedBytes = 0;
      await downloadAndInstallUpdate((event: DownloadEvent) => {
        switch (event.event) {
          case "Started":
            totalBytes = event.data.contentLength || 0;
            setState((prev) => ({
              ...prev,
              progress: { percent: 0, contentLength: totalBytes },
            }));
            break;
          case "Progress": {
            downloadedBytes += event.data.chunkLength;
            const percent =
              totalBytes > 0
                ? Math.min(100, Math.round((downloadedBytes / totalBytes) * 100))
                : 0;
            setState((prev) => ({
              ...prev,
              progress: { percent, contentLength: totalBytes },
            }));
            break;
          }
          case "Finished":
            setState((prev) => ({
              ...prev,
              progress: { percent: 100, contentLength: totalBytes },
            }));
            break;
        }
      });
    } catch (err) {
      setState((prev) => ({
        ...prev,
        downloading: false,
        error: err instanceof Error ? err.message : String(err),
      }));
    }
  }, []);

  useEffect(() => {
    if (checkOnMount) {
      check();
    }
  }, [checkOnMount, check]);

  return {
    ...state,
    check,
    dismiss,
    install,
  };
}
