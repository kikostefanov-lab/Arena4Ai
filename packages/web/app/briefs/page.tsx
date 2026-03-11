'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { FORMAT_BADGES } from '../../lib/design-tokens';
import { formatTimeLimit } from '../../lib/format';

interface BriefSummary {
  id: string;
  title: string;
  format: string;
  tags: string[];
  timeLimitMs: number;
  problemSnippet: string;
  filename: string;
}

export default function BriefsPage() {
  const [briefs, setBriefs] = useState<BriefSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('ALL');

  useEffect(() => {
    fetch('/api/briefs')
      .then((r) => r.json())
      .then((data: BriefSummary[]) => setBriefs(Array.isArray(data) ? data : []))
      .catch(() => setBriefs([]))
      .finally(() => setLoading(false));
  }, []);

  const allCategories = Array.from(
    new Set(briefs.flatMap((b) => b.tags ?? []))
  ).sort();

  const filtered = briefs.filter((b) => {
    const catMatch = categoryFilter === 'ALL' || b.tags?.includes(categoryFilter);
    if (!catMatch) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      return (
        b.title.toLowerCase().includes(q) ||
        b.problemSnippet.toLowerCase().includes(q) ||
        b.tags.some((t) => t.toLowerCase().includes(q))
      );
    }
    return true;
  });

  const font = "'SF Mono', 'Fira Code', 'Cascadia Code', monospace";

  return (
    <div style={{
      minHeight: '100vh',
      fontFamily: font,
      color: '#e4f8ff',
    }}>
      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .brief-card {
          transition: transform 0.18s ease, border-color 0.18s ease, box-shadow 0.18s ease;
        }
        .brief-card:hover {
          transform: translateY(-2px);
          box-shadow: 0 4px 24px rgba(0,240,255,0.15);
          border-color: #0e3050 !important;
        }
        .launch-btn {
          transition: background 0.15s ease, transform 0.1s ease;
        }
        .launch-btn:hover {
          background: #33f5ff !important;
          transform: translateY(-1px);
        }
        .nav-link {
          transition: color 0.15s ease, border-color 0.15s ease;
        }
        .nav-link:hover {
          color: #c8eef8 !important;
          border-color: #0e3050 !important;
        }
        .cat-btn {
          transition: all 0.15s ease;
        }
        .cat-btn:hover {
          border-color: rgba(0,128,255,0.4) !important;
          color: #7cc6db !important;
        }
        .search-input:focus {
          border-color: #0e3050 !important;
          outline: none;
        }
      `}</style>

      <div style={{ maxWidth: '960px', margin: '0 auto', padding: '2.5rem 1.5rem' }}>

        {/* Header */}
        <div style={{
          marginBottom: '2.5rem',
          padding: '2rem 0',
          borderBottom: '1px solid #0a2235',
        }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '1rem' }}>
            <div>
              <div style={{
                fontSize: '0.6rem',
                color: '#00f0ff',
                letterSpacing: '4px',
                textTransform: 'uppercase',
                marginBottom: '0.6rem',
                fontWeight: 700,
              }}>
                ◆ Brief Library
              </div>
              <h1 style={{
                fontSize: '2rem',
                fontWeight: 800,
                lineHeight: 1.05,
                margin: 0,
                background: 'linear-gradient(135deg, #c8eef8 0%, #00f0ff 50%, #0080ff 100%)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                fontFamily: font,
              }}>
                Competition Briefs
              </h1>
              <p style={{ fontSize: '0.72rem', color: '#4a8fa8', marginTop: '0.6rem' }}>
                {loading ? 'Loading…' : `${briefs.length} brief${briefs.length !== 1 ? 's' : ''} available`}
              </p>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginTop: '0.5rem' }}>
              <Link
                href="/"
                className="nav-link"
                style={{
                  fontSize: '0.62rem', color: '#4a8fa8', padding: '0.45rem 0.85rem',
                  border: '1px solid #0a2235', borderRadius: '4px', textDecoration: 'none',
                  letterSpacing: '1px', fontWeight: 600,
                }}
              >
                ← GALLERY
              </Link>
              <Link
                href="/competitions/new"
                style={{
                  fontSize: '0.62rem', fontWeight: 700, padding: '0.45rem 1.1rem',
                  background: '#00f0ff', color: '#000408', borderRadius: '4px',
                  textDecoration: 'none', letterSpacing: '1px', textTransform: 'uppercase',
                  display: 'inline-flex', alignItems: 'center', gap: '0.35rem',
                }}
                className="launch-btn"
              >
                ⚔️ New Battle
              </Link>
            </div>
          </div>
        </div>

        {/* Filters */}
        <div style={{ marginBottom: '1.5rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {/* Search */}
          <div style={{ position: 'relative', width: '100%' }}>
            <span style={{
              position: 'absolute', left: '0.65rem', top: '50%',
              transform: 'translateY(-50%)', fontSize: '0.8rem',
              pointerEvents: 'none', lineHeight: 1,
            }}>🔍</span>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search briefs by title, description, or tag..."
              className="search-input"
              style={{
                width: '100%',
                background: '#010810',
                border: '1px solid #0a2235',
                borderRadius: '6px',
                color: '#e4f8ff',
                fontSize: '0.72rem',
                fontFamily: font,
                padding: '0.5rem 2rem 0.5rem 2rem',
                boxSizing: 'border-box',
              }}
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                style={{
                  position: 'absolute', right: '0.6rem', top: '50%',
                  transform: 'translateY(-50%)', background: 'none',
                  border: 'none', color: '#4a8fa8', cursor: 'pointer',
                  fontSize: '0.75rem', lineHeight: 1, padding: '0.1rem',
                }}
                aria-label="Clear search"
              >
                ✕
              </button>
            )}
          </div>

          {/* Category chips */}
          {allCategories.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
              <span style={{
                fontSize: '0.55rem', color: '#1e4a5a', letterSpacing: '1px',
                textTransform: 'uppercase', marginRight: '0.2rem', fontWeight: 700,
              }}>Category</span>
              {(['ALL', ...allCategories]).map((cat) => {
                const active = categoryFilter === cat;
                return (
                  <button
                    key={cat}
                    className="cat-btn"
                    onClick={() => setCategoryFilter(cat)}
                    style={{
                      fontSize: '0.52rem', fontWeight: 700, padding: '0.2rem 0.65rem',
                      borderRadius: '3px', letterSpacing: '1px', cursor: 'pointer',
                      border: `1px solid ${active ? 'rgba(0,128,255,0.4)' : '#0a2235'}`,
                      background: active ? 'rgba(0,128,255,0.15)' : 'transparent',
                      color: active ? '#7cc6db' : '#1e4a5a',
                      fontFamily: font,
                    }}
                  >
                    {cat}
                  </button>
                );
              })}
            </div>
          )}

          {(searchQuery.trim() || categoryFilter !== 'ALL') && (
            <p style={{ fontSize: '0.62rem', color: '#1e4a5a', margin: 0, fontFamily: font }}>
              Showing {filtered.length} of {briefs.length} brief{briefs.length !== 1 ? 's' : ''}
            </p>
          )}
        </div>

        {/* Loading */}
        {loading && (
          <div style={{ textAlign: 'center', padding: '4rem 0' }}>
            <div style={{ fontSize: '1.5rem', marginBottom: '0.75rem' }}>📚</div>
            <p style={{ color: '#4a8fa8', fontSize: '0.75rem' }}>Loading briefs…</p>
          </div>
        )}

        {/* Empty (no API data) */}
        {!loading && briefs.length === 0 && (
          <div style={{
            textAlign: 'center', padding: '4rem 2rem',
            background: '#050f1e', border: '1px dashed #0a2235', borderRadius: '12px',
          }}>
            <div style={{ fontSize: '2rem', marginBottom: '0.75rem' }}>📭</div>
            <p style={{ color: '#4a8fa8', fontSize: '0.75rem' }}>
              No briefs found — is the API server running?
            </p>
          </div>
        )}

        {/* Empty filtered */}
        {!loading && briefs.length > 0 && filtered.length === 0 && (
          <div style={{
            textAlign: 'center', padding: '3rem 2rem',
            background: '#050f1e', border: '1px dashed #0a2235', borderRadius: '8px',
          }}>
            <p style={{ color: '#4a8fa8', fontSize: '0.75rem' }}>No briefs match your filters.</p>
          </div>
        )}

        {/* Brief Cards */}
        {!loading && filtered.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '1rem' }}>
            {filtered.map((brief, index) => {
              const fmt = FORMAT_BADGES[brief.format as keyof typeof FORMAT_BADGES] ?? null;
              return (
                <div
                  key={brief.id}
                  className="brief-card"
                  style={{
                    background: '#050f1e',
                    border: '1px solid #0a2235',
                    borderRadius: '10px',
                    padding: '1.25rem',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.75rem',
                    animation: `fadeIn 0.3s ease ${index * 0.04}s both`,
                  }}
                >
                  {/* Title + badges row */}
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.45rem' }}>
                      {fmt && (
                        <span style={{
                          fontSize: '0.5rem', fontWeight: 700, padding: '0.1rem 0.45rem',
                          borderRadius: '3px', letterSpacing: '1.2px',
                          background: fmt.bg, color: fmt.color,
                          display: 'inline-flex', alignItems: 'center', gap: '0.2rem',
                        }}>
                          <span style={{ fontSize: '0.55rem' }}>{fmt.icon}</span> {fmt.label}
                        </span>
                      )}
                      <span style={{
                        fontSize: '0.5rem', fontWeight: 600, color: '#3d7d94',
                        letterSpacing: '0.5px',
                      }}>
                        ⏱ {formatTimeLimit(brief.timeLimitMs)}
                      </span>
                    </div>
                    <h2 style={{
                      fontSize: '0.88rem', fontWeight: 700, color: '#e4f8ff',
                      margin: 0, lineHeight: 1.3,
                    }}>
                      {brief.title}
                    </h2>
                  </div>

                  {/* Tags */}
                  {brief.tags.length > 0 && (
                    <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                      {brief.tags.map((tag) => (
                        <span
                          key={tag}
                          style={{
                            fontSize: '0.48rem', fontWeight: 700, padding: '0.1rem 0.4rem',
                            borderRadius: '3px', letterSpacing: '0.8px',
                            background: 'rgba(0,128,255,0.12)', color: '#7cc6db',
                            border: '1px solid rgba(0,128,255,0.18)',
                            cursor: 'pointer',
                          }}
                          onClick={() => setCategoryFilter(tag)}
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Problem snippet */}
                  {brief.problemSnippet && (
                    <p style={{
                      fontSize: '0.65rem', color: '#3d7d94', lineHeight: 1.55,
                      margin: 0, flex: 1,
                      display: '-webkit-box',
                      WebkitLineClamp: 3,
                      WebkitBoxOrient: 'vertical' as const,
                      overflow: 'hidden',
                    }}>
                      {brief.problemSnippet}{brief.problemSnippet.length === 200 ? '…' : ''}
                    </p>
                  )}

                  {/* Launch button */}
                  <Link
                    href={`/competitions/new`}
                    className="launch-btn"
                    style={{
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      gap: '0.4rem', fontSize: '0.62rem', fontWeight: 700,
                      padding: '0.5rem 1rem', background: '#00f0ff', color: '#000408',
                      borderRadius: '5px', textDecoration: 'none', letterSpacing: '0.5px',
                      marginTop: 'auto',
                    }}
                  >
                    ⚔️ Launch →
                  </Link>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
