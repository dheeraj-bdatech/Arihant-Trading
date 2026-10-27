'use client';

import { PathRedirect } from '../../performance/_lib/PathRedirect';

/** My performance moved to the Performance area (/performance). */
export default function Page() {
  return <PathRedirect to="/performance" />;
}
