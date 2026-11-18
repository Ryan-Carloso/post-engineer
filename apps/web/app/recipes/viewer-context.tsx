'use client';

import { createContext, useContext } from 'react';

const SignedInContext = createContext(false);

export function ViewerProvider({
  signedIn,
  children,
}: {
  signedIn: boolean;
  children: React.ReactNode;
}): React.ReactElement {
  return <SignedInContext.Provider value={signedIn}>{children}</SignedInContext.Provider>;
}

export function useSignedIn(): boolean {
  return useContext(SignedInContext);
}
