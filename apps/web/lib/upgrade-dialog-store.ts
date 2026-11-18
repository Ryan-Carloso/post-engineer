import { create } from 'zustand';

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

export function openUpgradeDialogIfInsufficient(status: number, code?: unknown): boolean {
  if (status !== 402) return false;
  useUpgradeDialogStore.getState().open(code === 'FREE_EXHAUSTED' ? 'free' : 'generic');
  return true;
}
