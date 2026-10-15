'use client';

import React from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';
import { canOpen } from '@/lib/route-access';

/**
 * A link to another module that only renders as a link when the viewer's role may open that page;
 * otherwise it shows the same content as plain text instead of leading to an "access denied" screen.
 */
export function GuardedLink({ href, className = '', title, children }: { href: string; className?: string; title?: string; children: React.ReactNode }) {
  const { user } = useAuth();
  if (canOpen(user?.role, href)) {
    return (
      <Link href={href} className={className} title={title}>
        {children}
      </Link>
    );
  }
  return <span className={className.split(/\s+/).filter((c) => !c.startsWith('hover:')).join(' ')}>{children}</span>;
}
