import React from 'react';

/** Arihant shield mark. Inherits colour, so it works on every theme. */
export const BrandMark: React.FC<{ className?: string }> = ({ className = 'h-6 w-6' }) => (
  <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden>
    <path d="M12 2.5 4.5 5.4v5.7c0 4.6 3.1 8.5 7.5 10.4 4.4-1.9 7.5-5.8 7.5-10.4V5.4L12 2.5Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" fill="currentColor" fillOpacity="0.16" />
    <path d="m8.6 15.2 3.4-7.4 3.4 7.4M9.9 12.9h4.2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
