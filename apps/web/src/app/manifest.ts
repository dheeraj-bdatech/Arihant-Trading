import type { MetadataRoute } from 'next';

/** Web app manifest — makes the BOS installable as a standalone app (Chrome "Install", iOS "Add to Home Screen"). */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'Arihant BOS',
    short_name: 'Arihant BOS',
    description: 'Business Operating System for Arihant Trading Corporation — GeM tenders, field operations, service and expenses.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#F6F5F1',
    theme_color: '#F6F5F1',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
