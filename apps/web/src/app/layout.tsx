import type { Metadata } from 'next';
import { GeistSans } from 'geist/font/sans';
import { GeistMono } from 'geist/font/mono';
import './globals.css';
import './theme.css';
import { AuthProvider } from '@/lib/auth-context';
import { PersonaSwitcherFab } from '@/components/layout/PersonaSwitcherFab';
import { ThemeProvider, THEME_BOOT_SCRIPT, DEFAULT_THEME } from '@/lib/theme-context';

export const metadata: Metadata = {
  title: 'Arihant BOS | Defence & Security GeM ERP',
  description:
    'Comprehensive Business Operating System for Arihant Trading Corporation - Security & Defence Equipment, GeM Tenders, and Field Operations.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${GeistSans.variable} ${GeistMono.variable}`}
      data-app-theme={DEFAULT_THEME}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600&family=IBM+Plex+Sans:wght@400;500;600;700&family=Source+Serif+4:opsz,wght@8..60,400;8..60,600;8..60,700&display=swap"
        />
      </head>
      <body
        className="font-sans bg-[#F6F5F1] text-[#14213D] text-[14px] antialiased selection:bg-[#E3EFEE] selection:text-[#0F5E63]"
        suppressHydrationWarning
      >
        <ThemeProvider>
          <AuthProvider>
            {children}
            <PersonaSwitcherFab />
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
