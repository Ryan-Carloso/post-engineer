'use client';

import { createContext, useContext } from 'react';

//---------------
// Prompts hub viewer — whether the visitor is signed in. The layout
// already resolves the user server-side to pick the frame, so it hands
// the answer down here instead of the page fetching the session again.
// Step 1 of the hub uses it: the key manager when signed in, a sign-in
// call to action otherwise.
//---------------

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
