'use client';

import { PathRedirect } from '../../performance/_lib/PathRedirect';

/** Team performance moved to the Performance area (/performance/team). */
export default function Page() {
  return <PathRedirect to="/performance/team" />;
}
