'use client';

import { PathRedirect } from '../../performance/_lib/PathRedirect';

/** Performance evidence moved to the Performance area (/performance/evidence). */
export default function Page() {
  return <PathRedirect to="/performance/evidence" />;
}
