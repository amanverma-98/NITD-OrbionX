import { Link, useLocation } from 'react-router-dom';
import { useState } from 'react';
import phoenixLogo from '../assets/pheonix.png';

const navLinks = [
  { path: '/dashboard', label: 'Dashboard' },
  { path: '/visualization', label: 'Visualization' },
  { path: '/collisions', label: 'Collisions' },
  { path: '/prediction', label: 'Prediction' }
];

export default function Navbar({ session, onSignOut }) {
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const userEmail = session?.user?.email || '';
  const navSurfaceStyle = {
    background: 'var(--theme-nav-bg, rgba(15, 23, 42, 0.72))',
    borderColor: 'var(--theme-nav-border, var(--glass-border))',
    boxShadow: '0 10px 32px var(--theme-nav-glow, rgba(6, 182, 212, 0.18))',
  };

  const activeLinkStyle = {
    background: 'linear-gradient(90deg, var(--theme-nav-accent, #06b6d4), var(--theme-nav-accent-alt, #a855f7))',
    color: 'var(--theme-nav-text, #bae6fd)',
    borderColor: 'var(--theme-nav-border, rgba(6, 182, 212, 0.35))',
    boxShadow: '0 8px 22px var(--theme-nav-glow, rgba(6, 182, 212, 0.2))',
  };

  return (
    <div className="w-screen z-40 px-2 sm:px-3 lg:px-4 mb-2 sm:mb-3">
      <nav
        className="w-screen fixed top-0 left-0 rounded-b-nonerounded-xl px-4 sm:px-6 lg:px-5 py-3 sm:py-4 backdrop-blur-xl"
        style={navSurfaceStyle}
      >
      <div className="w-full flex items-center justify-between gap-3 sm:gap-4">
        {/* Logo & Branding */}
        <Link to="/" className="flex items-center gap-2 sm:gap-3 group flex-shrink-0 md:flex-1">
          <img
            src={phoenixLogo}
            alt="OrbionX Phoenix Logo"
            className="w-9 sm:w-11 h-9 sm:h-11 object-contain rounded-lg"
          />
          <div className="hidden sm:flex flex-col">
            <span className="text-sm sm:text-lg font-bold font-['Outfit'] tracking-tight leading-tight">
              <span className="gradient-text">Orbion</span>
              <span className="text-white">X</span>
            </span>
            <span className="text-xs text-slate-500 font-medium">AI Satelite Intelligence</span>
          </div>
        </Link>

        {/* Desktop Nav Links */}
        <div className="hidden md:flex flex-1 items-center justify-center gap-2 lg:gap-3">
          {navLinks.map((link) => {
            const isActive = location.pathname === link.path;
            return (
              <Link
                key={link.path}
                to={link.path}
                className={`btn-base flex items-center gap-2 px-3 sm:px-4 py-2 rounded-[14px] text-xs sm:text-sm font-semibold transition-all duration-300 relative group
                  ${isActive
                    ? 'px-4 sm:px-5 py-2.5 shadow-lg border'
                    : 'text-slate-400 hover:text-white'
                  }`}
                style={isActive ? activeLinkStyle : undefined}
              >
                {link.label}
                
                {/* Underline Animation on Hover */}
                {!isActive && (
                  <div
                    className="absolute bottom-0 left-4 right-4 h-0.5 rounded-full scale-x-0 group-hover:scale-x-100 transition-transform duration-300 origin-left"
                    style={{ background: 'linear-gradient(90deg, var(--theme-nav-accent, #06b6d4), var(--theme-nav-accent-alt, #a855f7))' }}
                  />
                )}
              </Link>
            );
          })}
        </div>

        {/* Status Indicator & Settings */}
        <div className="hidden md:flex flex-1 items-center justify-end gap-2 sm:gap-3">
          {/* Live Status Badge */}
          <div className="flex items-center gap-2 px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-full bg-gradient-to-r from-green-500/15 to-emerald-500/15 border border-green-500/30 text-xs sm:text-xs">
            <span className="w-2 h-2 sm:w-2.5 sm:h-2.5 rounded-full bg-gradient-to-r from-green-400 to-emerald-400 animate-pulse-glow-strong"></span>
            <span className="font-semibold text-green-300 tracking-wider hidden sm:inline">LIVE</span>
            <span className="font-semibold text-green-300 tracking-wider sm:hidden">ON</span>
          </div>
          {userEmail && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-300 max-w-[220px] truncate">{userEmail}</span>
              <button
                onClick={onSignOut}
                className="px-3 py-1.5 text-xs rounded-lg bg-slate-800/70 text-slate-200 border border-slate-600 transition"
                style={{
                  borderColor: 'var(--theme-nav-border, #475569)',
                  color: 'var(--theme-nav-text, #e2e8f0)',
                }}
              >
                Sign Out
              </button>
            </div>
          )}
        </div>

        {/* Mobile Toggle - Enhanced */}
        <button
          onClick={() => setMobileOpen(!mobileOpen)}
          className="md:hidden ml-auto text-slate-400 p-2 transition-colors touch-target"
          style={{ color: 'var(--theme-nav-text, #94a3b8)' }}
        >
          {mobileOpen ? (
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          ) : (
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          )}
        </button>
      </div>

      {/* Mobile Menu - Enhanced with Gradient Backdrop */}
      {mobileOpen && (
        <div className="md:hidden mt-3 pt-3 border-t border-[var(--glass-border)] space-y-1.5 animate-slide-in-right">
          {navLinks.map((link, index) => {
            const isActive = location.pathname === link.path;
            return (
              <Link
                key={link.path}
                to={link.path}
                onClick={() => setMobileOpen(false)}
                className={`btn-base flex items-center px-4 py-2.5 rounded-[14px] transition-all duration-200 stagger-${index + 1}
                  ${isActive
                      ? 'text-cyan-300 border'
                    : 'text-slate-300 hover:text-cyan-300 hover:bg-white/5'
                  }`}
                  style={isActive ? activeLinkStyle : undefined}
              >
                <span className="font-semibold">{link.label}</span>
              </Link>
            );
          })}
          
          {/* Mobile Status */}
          <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-white/5 border border-green-500/30">
            <span className="w-2.5 h-2.5 rounded-full bg-gradient-to-r from-green-400 to-emerald-400 animate-pulse-glow-strong"></span>
            <span className="text-sm font-semibold text-green-300">LIVE - System Active</span>
          </div>
          {userEmail && (
            <button
              onClick={() => {
                onSignOut?.();
                setMobileOpen(false);
              }}
              className="btn-base flex items-center justify-center px-4 py-2.5 rounded-[14px] text-slate-300 hover:bg-white/5 border border-slate-700/60 transition-all duration-200"
              style={{
                borderColor: 'var(--theme-nav-border, rgba(51, 65, 85, 0.85))',
                color: 'var(--theme-nav-text, #cbd5e1)',
              }}
            >
              <span className="font-semibold">Sign Out</span>
            </button>
          )}
        </div>
      )}
      </nav>
    </div>
  );
}
