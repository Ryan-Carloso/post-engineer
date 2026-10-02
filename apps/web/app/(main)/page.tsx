import { redirect } from 'next/navigation';

//---------------
// The root route is not a page of its own — the posts list is the app's
// home. A redirect here (instead of a next.config rewrite) keeps the
// session middleware in front: an unauthenticated visitor is bounced to
// /landing by the middleware, never through a redirect chain.
//
// Redirecting at the page level rather than re-exporting the posts page
// also means there is exactly one posts implementation to maintain.
//---------------

export default function Home(): never {
  redirect('/posts');
}
