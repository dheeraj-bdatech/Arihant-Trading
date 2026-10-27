import { redirect } from 'next/navigation';

/** Waiting on me was retired; old links and bookmarks land on the task board. */
export default function Page() {
  redirect('/tasks');
}
