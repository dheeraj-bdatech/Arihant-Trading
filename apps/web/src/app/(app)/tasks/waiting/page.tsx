'use client';

import { PathRedirect } from '../../performance/_lib/PathRedirect';

/** Waiting on me was retired; old links and bookmarks land on the task board. */
export default function Page() {
  return <PathRedirect to="/tasks" />;
}
