import { create } from "zustand";

interface PaletteStore {
  open: boolean;
  /** The id of the control that opened the palette; focus returns there on Escape or Close (R27). */
  openerId: string | null;
  /** Opens the Go palette; phase 3 hotkeys and gamepad Start call it too (spec §5.9). */
  openPalette: (openerId: string | null) => void;
  closePalette: () => void;
  reset: () => void;
}

/** Whether the Go palette is open, and who opened it (spec §5.1). Reset with the session (R22). */
export const usePaletteStore = create<PaletteStore>()((set) => ({
  open: false,
  openerId: null,
  openPalette: (openerId) => set({ open: true, openerId }),
  closePalette: () => set({ open: false }),
  reset: () => set({ open: false, openerId: null }),
}));
