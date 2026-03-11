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
        {/* BG-006: Ambient radial glow — fixed, behind everything */}
        <div className="hero-glow-center" />
        {/* BG-003: CRT scanlines overlay */}
        <div className="scanlines" />
        {/* BG-004: Corner bracket HUD elements */}
        <div className="corner corner-tl" />
        <div className="corner corner-tr" />
        <div className="corner corner-bl" />
        <div className="corner corner-br" />
        {/* BG-008: Main content above all overlays */}
        <main style={{ position: 'relative', zIndex: 2 }}>{children}</main>
      </body>
    </html>
  );
}
