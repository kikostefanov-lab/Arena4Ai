import type { Metadata } from 'next';
import { Orbitron } from 'next/font/google';
import './globals.css';

const orbitron = Orbitron({
  subsets: ['latin'],
  weight: ['400', '700', '900'],
  variable: '--font-orbitron',
});

export const metadata: Metadata = {
  title: 'Arena4Ai',
  description: 'AI Agent Competition Platform — Arena4Ai',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={orbitron.variable}>
      <body style={{ margin: 0, padding: 0, background: '#000408' }}>
        <main>{children}</main>
      </body>
    </html>
  );
}
