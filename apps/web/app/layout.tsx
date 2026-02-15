import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Military Career Life Simulator',
  description: 'Real-time military career simulation with server-authoritative progression.'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-bg text-text antialiased">
        <main className="mx-auto min-h-screen w-full max-w-[120rem] px-2 py-1.5 md:px-3 md:py-2">{children}</main>
      </body>
    </html>
  );
}
