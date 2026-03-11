'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { MONOSPACE_FONT, FONT_WEIGHT_EXTRABOLD } from '../lib/design-tokens';

const NAV_LINKS = [
  { href: '/competitions/new', label: 'New Battle' },
  { href: '/leaderboard',      label: 'Leaderboard' },
  { href: '/analytics',        label: 'Analytics' },
  { href: '/tournaments/new',  label: 'Tournament' },
];

export function TopBar() {
  const pathname = usePathname();

  return (
    <nav style={{
      position: 'fixed', top: 0, left: 0, right: 0,
      zIndex: 100,
      padding: '0.9rem 2rem',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      background: 'linear-gradient(to bottom, rgba(0,4,8,0.92) 0%, rgba(0,4,8,0) 100%)',
    }}>
      {/* Logo */}
      <Link href="/" style={{ textDecoration: 'none' }}>
        <span style={{
          fontFamily: MONOSPACE_FONT,
          fontSize: '0.75rem', fontWeight: FONT_WEIGHT_EXTRABOLD,
          letterSpacing: '6px', textTransform: 'uppercase',
          color: '#00f0ff',
        }}>
          ARENA<span style={{ color: '#ff6600' }}>4</span>AI
        </span>
      </Link>

      {/* Nav links */}
      <div style={{ display: 'flex', gap: '0.5rem' }}>
        {NAV_LINKS.map(({ href, label }) => (
          <Link
            key={href}
            href={href}
            className="arena-btn"
            style={pathname === href ? {
              borderColor: 'rgba(0,240,255,0.6)',
              background: 'rgba(0,240,255,0.1)',
            } : undefined}
          >
            {label}
          </Link>
        ))}
      </div>
    </nav>
  );
}
