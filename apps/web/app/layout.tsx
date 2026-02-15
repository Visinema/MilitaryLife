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
        <main className="mx-auto min-h-screen w-full max-w-4xl px-3 py-4 md:px-4 md:py-5">{children}</main>
      </body>
    </html>
  );
}
