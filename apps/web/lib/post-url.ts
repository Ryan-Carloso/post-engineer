//---------------
// post-url — the one place that builds the absolute post detail link
// (issue #555). The agent sends this link in chat so the owner can watch
// / download the video and edit / reschedule / delete the post from its
// detail page. Every surface that returns a slot (post detail, schedule
// status, video status) builds it through here so the path never drifts.
//---------------
export function postUrlFor(origin: string, slotId: string): string {
  return `${origin}/posts/${slotId}`;
}
