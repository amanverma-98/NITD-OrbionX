import React from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import Navbar from './Navbar';

const houseThemeByRoute = [
  {
    match: '/dashboard',
    vars: {
      '--cyan-glow': '#d3a625',
      '--cyan-bright': '#f2cf63',
      '--gradient-primary': 'linear-gradient(135deg, #740001, #d3a625)',
      '--gradient-primary-reverse': 'linear-gradient(135deg, #d3a625, #740001)',
      '--glass-border': 'rgba(211, 166, 37, 0.2)',
      '--glass-border-hover': 'rgba(211, 166, 37, 0.42)',
      '--glass-border-active': 'rgba(116, 0, 1, 0.58)',
      '--theme-nav-bg': 'rgba(35, 8, 10, 0.82)',
      '--theme-nav-border': 'rgba(211, 166, 37, 0.35)',
      '--theme-nav-text': '#f6df9b',
      '--theme-nav-accent': '#740001',
      '--theme-nav-accent-alt': '#d3a625',
      '--theme-nav-glow': 'rgba(211, 166, 37, 0.35)',
    },
    // background: 'linear-gradient(145deg, #140507 0%, #23090d 40%, #4f130f 70%, #7a4f12 100%)',
    background: '#4f130f',
  },
  {
    match: '/visualization',
    vars: {
      '--cyan-glow': '#2a623d',
      '--cyan-bright': '#84b98d',
      '--gradient-primary': 'linear-gradient(135deg, #1a472a, #5d5d5d)',
      '--gradient-primary-reverse': 'linear-gradient(135deg, #5d5d5d, #1a472a)',
      '--glass-border': 'rgba(132, 185, 141, 0.2)',
      '--glass-border-hover': 'rgba(132, 185, 141, 0.4)',
      '--glass-border-active': 'rgba(26, 71, 42, 0.58)',
      '--theme-nav-bg': 'rgba(12, 23, 17, 0.84)',
      '--theme-nav-border': 'rgba(132, 185, 141, 0.35)',
      '--theme-nav-text': '#c7dfcc',
      '--theme-nav-accent': '#1a472a',
      '--theme-nav-accent-alt': '#84b98d',
      '--theme-nav-glow': 'rgba(132, 185, 141, 0.28)',
    },
    background: 'linear-gradient(145deg, #07130d 0%, #10241a 42%, #1a472a 74%, #2a623d 100%)',
  },
  {
    match: '/collisions',
    vars: {
      '--cyan-glow': '#ecb939',
      '--cyan-bright': '#f7d77d',
      '--gradient-primary': 'linear-gradient(135deg, #ecb939, #372e29)',
      '--gradient-primary-reverse': 'linear-gradient(135deg, #372e29, #ecb939)',
      '--glass-border': 'rgba(236, 185, 57, 0.2)',
      '--glass-border-hover': 'rgba(236, 185, 57, 0.4)',
      '--glass-border-active': 'rgba(55, 46, 41, 0.64)',
      '--theme-nav-bg': 'rgba(27, 21, 16, 0.84)',
      '--theme-nav-border': 'rgba(236, 185, 57, 0.35)',
      '--theme-nav-text': '#f9e8b8',
      '--theme-nav-accent': '#ecb939',
      '--theme-nav-accent-alt': '#7a5f22',
      '--theme-nav-glow': 'rgba(236, 185, 57, 0.34)',
    },
    background:'#0a0908'
    // background: 'linear-gradient(145deg, #15110d 0%, #261e14 40%,  72%, #7e6528 100%)',
  },
  {
    match: '/prediction',
    vars: {
      '--cyan-glow': '#6f84b8',
      '--cyan-bright': 'skyblue',
      '--gradient-primary': 'linear-gradient(90deg,#091747,#2847b8,#5678f0 )',
      '--gradient-primary-reverse': 'linear-gradient(135deg, #946b2d, #0e1a40)',
      '--glass-border': 'rgba(111, 132, 184, 0.25)',
      '--glass-border-hover': 'rgba(111, 132, 184, 0.45)',
      '--glass-border-active': 'rgba(14, 26, 64, 0.62)',
      '--theme-nav-bg': 'rgba(10, 16, 36, 0.84)',
      '--theme-nav-border': 'rgba(111, 132, 184, 0.38)',
      '--theme-nav-text': '#d7dff2',
      '--theme-nav-accent': '#0e1a40',
      '--theme-nav-accent-alt': '#000000',
      '--theme-nav-glow': 'rgba(111, 132, 184, 0.28)',
    },
    // background: 'linear-gradient(145deg, #050912 0%, #101c44 42%, #243a7a 74%, #5f4a22 100%)',
    background:'#243a7a'
  },
];

/**
 * Layout Component
 * Wraps pages with consistent spacing, padding, and conditional Navbar rendering
 * Used by all pages except Landing
 */
const Layout = ({
  children,
  showNavbar = true,
  className = '',
  session = null,
  onSignOut = null,
}) => {
  const location = useLocation();
  const isFullWidthRoute = [
    '/dashboard',
    '/visualization',
    '/collisions',
    '/prediction',
  ].some((route) => location.pathname.startsWith(route));
  const isVisualizationRoute = location.pathname.startsWith('/visualization');
  const activeHouseTheme = houseThemeByRoute.find((item) => location.pathname.startsWith(item.match));
  const contentWrapperClass = isFullWidthRoute
    ? (isVisualizationRoute ? 'w-full h-full' : 'w-full')
    : 'w-full max-w-[1400px] mx-auto';
  const content = children ?? <Outlet />;

  return (
    <div
      className="h-screen w-full flex flex-col max-w-[2400px] mx-auto overflow-hidden"
      style={activeHouseTheme ? { ...activeHouseTheme.vars, background: activeHouseTheme.background } : undefined}
    >
      {showNavbar && <Navbar session={session} onSignOut={onSignOut} />}

      {/* Main Content Area */}
      <main
        className={`flex-1 min-h-0 pt-15 w-full overflow-y-auto overflow-x-hidden ${className}`}
      >
        <div className={contentWrapperClass}>
          {content}
        </div>
      </main>
    </div>
  );
};

export default Layout;
