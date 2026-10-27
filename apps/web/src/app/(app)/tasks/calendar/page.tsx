'use client';

import { TaskSectionRedirect } from '../_lib/TaskSections';

/** Leave & holidays is a tab on /tasks now; old links and bookmarks land there with their query string. */
export default function Page() {
  return <TaskSectionRedirect section="leave" />;
}
