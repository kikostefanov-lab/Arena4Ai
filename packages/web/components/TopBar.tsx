'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { MONOSPACE_FONT, FONT_WEIGHT_EXTRABOLD } from '../lib/design-tokens';

const NAV_LINKS = [
  { href: '/briefs',          label: 'Briefs'       },
  { href: '/leaderboard',     label: 'Leaderboard'  },
  { href: '/analytics',       label: 'Analytics'    },
  { href: '/tournaments/new', label: 'Tournaments'  },
  { href: '/compare',         label: 'Compare'      },
  { href: '/agent-armory',    label: 'Armory'       },
];

export function TopBar() {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close menu on route change
  useEffect(() => { setMenuOpen(false); }, [pathname]);

  // Close menu on outside click
  useEffect(() => {
    if (!menuOpen) return;
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [menuOpen]);

  return (
    <nav className="topbar" ref={menuRef}>
      {/* Logo */}
      <Link href="/" style={{ textDecoration: 'none', flexShrink: 0 }}>
        <span className="topbar-logo" style={{
          fontFamily: MONOSPACE_FONT,
          fontWeight: FONT_WEIGHT_EXTRABOLD,
          textTransform: 'uppercase',
          color: '#00f0ff',
          lineHeight: 1,
        }}>
          ARENA<span style={{ color: '#ff6600' }}>4</span>AI
        </span>
      </Link>

      {/* Desktop nav */}
      <div className="topbar-nav topbar-desktop">
        {NAV_LINKS.map(({ href, label }) => (
          <Link
            key={href}
            href={href}
            className="arena-btn topbar-nav-btn"
            style={pathname === href ? {
              borderColor: 'rgba(0,240,255,0.6)',
              background: 'rgba(0,240,255,0.1)',
            } : undefined}
          >
            {label}
          </Link>
        ))}
        <Link href="/competitions/new" className="arena-btn arena-btn-primary new-comp-btn topbar-cta">
          ⚔ New Battle
        </Link>
      </div>

      {/* Mobile: hamburger + CTA */}
      <div className="topbar-mobile">
        <Link href="/competitions/new" className="arena-btn arena-btn-primary new-comp-btn topbar-cta">
          ⚔ New Battle
        </Link>
        <button
          className="topbar-hamburger"
          onClick={() => setMenuOpen((o) => !o)}
          aria-label="Toggle navigation"
          aria-expanded={menuOpen}
        >
          <span className={`topbar-hamburger-icon${menuOpen ? ' open' : ''}`} />
        </button>
      </div>

      {/* Dropdown menu */}
      {menuOpen && (
        <div className="topbar-dropdown">
          {NAV_LINKS.map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              className="topbar-dropdown-item"
              style={pathname === href ? {
                color: '#00f0ff',
                borderLeftColor: '#00f0ff',
              } : undefined}
              onClick={() => setMenuOpen(false)}
            >
              {label}
            </Link>
          ))}
          <div className="topbar-dropdown-divider" />
          <Link
            href="/competitions/new"
            className="topbar-dropdown-item topbar-dropdown-cta"
            onClick={() => setMenuOpen(false)}
          >
            ⚔ New Battle
          </Link>
        </div>
      )}
    </nav>
  );
}
