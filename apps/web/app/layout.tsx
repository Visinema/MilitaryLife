import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Military Career Life Simulator',
  description: 'Real-time military career simulation with server-authoritative progression.'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <style>{`html,body{margin:0;padding:0;background:#d7dbe2;color:#0b1220}`}</style>
      </head>
      <body className="bg-bg text-text antialiased">
        <main className="mx-auto min-h-screen w-full max-w-[120rem] px-2 py-1.5 md:px-3 md:py-2">{children}</main>
      </body>
    </html>
  );
}
