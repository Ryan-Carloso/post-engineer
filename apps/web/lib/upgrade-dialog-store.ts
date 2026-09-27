import { create } from 'zustand';

//---------------
// Upgrade Dialog Store — controls the global "insufficient tokens" dialog.
// Any flow that receives a 402 from the backend calls openUpgradeDialog();
// the dialog is rendered once in MainLayout.
//---------------

interface UpgradeDialogState {
  isOpen: boolean;
  variant: 'generic' | 'free';
  open: (variant?: 'generic' | 'free') => void;
  close: () => void;
}

export const useUpgradeDialogStore = create<UpgradeDialogState>((set) => ({
  isOpen: false,
  variant: 'generic',
  open: (variant = 'generic') => set({ isOpen: true, variant }),
  close: () => set({ isOpen: false }),
}));

//---------------
// openUpgradeDialogIfInsufficient — helper to use directly in fetch error
// fetch: `if (openUpgradeDialogIfInsufficient(response.status)) return;`
// When the backend signals FREE_EXHAUSTED, opens the "free" variant
// (you already used your free tokens → buy here).
//---------------
export function openUpgradeDialogIfInsufficient(status: number, code?: unknown): boolean {
  if (status !== 402) return false;
  useUpgradeDialogStore.getState().open(code === 'FREE_EXHAUSTED' ? 'free' : 'generic');
  return true;
}
