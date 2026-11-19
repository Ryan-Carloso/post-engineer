import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';

const redirect = vi.hoisted(() => vi.fn());

vi.mock('next/navigation', () => ({ redirect }));

import Home from '../page';

describe('root route', () => {
  it('sends the user to the posts list', () => {
    Home();
    expect(redirect).toHaveBeenCalledWith('/posts');
  });
});
