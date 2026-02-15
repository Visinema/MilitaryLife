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
        <main className="mx-auto min-h-screen w-full max-w-none px-1 py-1 md:px-2 md:py-1.5">{children}</main>
      </body>
    </html>
  );
}
