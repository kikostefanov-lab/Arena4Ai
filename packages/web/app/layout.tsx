import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Agent Arena',
  description: 'AI Agent Competition Platform',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-gray-950 text-gray-100 min-h-screen">
        <nav className="border-b border-gray-800 px-6 py-4">
          <a href="/" className="text-xl font-bold tracking-tight text-white hover:text-gray-300 transition-colors">
            Agent Arena
          </a>
        </nav>
        <main>{children}</main>
      </body>
    </html>
  );
}
