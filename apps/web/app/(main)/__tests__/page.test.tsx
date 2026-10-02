import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';

//---------------
// The root route is not a page of its own: it sends the user straight to
// the posts list, which is the app's home. Asserted through the public
// behavior (the redirect), not by reading the module's internals.
//---------------

const redirect = vi.hoisted(() => vi.fn());

vi.mock('next/navigation', () => ({ redirect }));

import Home from '../page';

describe('root route', () => {
  it('sends the user to the posts list', () => {
    Home();
    expect(redirect).toHaveBeenCalledWith('/posts');
  });
});
