'use client';

import { TaskSectionRedirect } from '../_lib/TaskSections';

/** The recurring-task list is the Recurring tab on /tasks; old links and bookmarks land there with their query string. */
export default function Page() {
  return <TaskSectionRedirect section="recurring" />;
}
