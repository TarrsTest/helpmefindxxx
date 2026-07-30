import type { Metadata } from 'next';
import './globals.css';
import { config } from '@fortawesome/fontawesome-svg-core';
import '@fortawesome/fontawesome-svg-core/styles.css';

// Tell FA not to inject CSS twice — we import the stylesheet manually above.
config.autoAddCss = false;

export const metadata: Metadata = {
  title: 'My App',
  description: 'Built with Tarrs',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-white text-zinc-900 antialiased">{children}</body>
    </html>
  );
}
