import { Link } from 'react-router-dom';
import {
  BarChart3,
  Bot,
  Globe2,
  Radar,
  ShieldAlert,
  WandSparkles,
} from 'lucide-react';
import backgroundImage from '../assets/background.avif';
import deerImage from '../assets/deer.jpg';

const features = [
  {
    icon: Radar,
    title: 'Real-Time Tracking',
    desc: 'Monitor thousands of satellites with live position updates from Celestrak TLE data.',
    color: 'cyan',
  },
  {
    icon: ShieldAlert,
    title: 'Collision Detection',
    desc: 'KD-Tree spatial indexing detects potential collisions in real-time with sub-kilometer precision.',
    color: 'red',
  },
  {
    icon: Bot,
    title: 'AI Risk Prediction',
    desc: 'RandomForest ML model predicts collision risk levels using orbital feature engineering.',
    color: 'green',
  },
  {
    icon: Globe2,
    title: '3D Visualization',
    desc: 'Immersive Three.js Earth with satellite rendering, orbit paths, and collision overlays.',
    color: 'blue',
  },
  {
    icon: WandSparkles,
    title: 'Orbit Prediction',
    desc: 'SGP4 propagation simulates future trajectories up to 7 days ahead.',
    color: 'purple',
  },
  {
    icon: BarChart3,
    title: 'Analytics Dashboard',
    desc: 'Comprehensive situational awareness with orbit distribution and live alert monitoring.',
    color: 'amber',
  },
];

export default function Landing({ session, authError, onGoogleSignIn, authLoading = false }) {
  return (
    <div className="landing-shell">
      <div className="landing-bg" style={{ backgroundImage: `url(${backgroundImage})` }} aria-hidden="true" />
      <div className="landing-fog" aria-hidden="true" />

      <section className="landing-hero">
        <div className="landing-text animate-fade-in-up">
          <p className="landing-kicker">Chapter Four: Orbital Vigil</p>
          <h1 className="landing-title">OrbionX</h1>
          <p className="landing-lead">Always watching the satellites, forever protecting the orbit.</p>
          <p className="landing-copy">
            A cinematic command surface for live tracking, risk prediction, and collision awareness across the near-Earth sky.
          </p>

          <div className="landing-actions">
            {session ? (
              <Link to="/dashboard" className="landing-cta landing-cta-primary">
                Launch Dashboard
                <span aria-hidden="true">→</span>
              </Link>
            ) : (
              <button
                onClick={onGoogleSignIn}
                disabled={authLoading}
                className="landing-cta landing-cta-primary"
              >
                {authLoading ? 'Checking Session...' : 'Continue with Google'}
                <span aria-hidden="true">↗</span>
              </button>
            )}

            <Link to="/visualization" className="landing-cta landing-cta-ghost">
              View Globe
              <span aria-hidden="true">◌</span>
            </Link>
          </div>

          {authError && <p className="landing-auth-error">{authError}</p>}
          {!session && (
            <p className="landing-auth-note">
              Sign in is required to access dashboard, collisions, and prediction routes.
            </p>
          )}
        </div>

        <div className="landing-visual animate-fade-in-up">
          <div className="landing-visual-glow" aria-hidden="true" />
          <img src={deerImage} alt="Silver deer emblem" className="landing-deer-image" />
        </div>
      </section>

      <section className="landing-feature-zone">
        <div className="landing-feature-header animate-fade-in-up">
          <h2>Space Situational Awareness</h2>
          <p>Professional-grade tools for monitoring orbital space, powered by real data and machine learning.</p>
        </div>

        <div className="landing-feature-grid">
          {features.map((feat, i) => (
            <article
              key={i}
              className="landing-feature-card animate-fade-in-up"
              style={{ animationDelay: `${i * 90}ms` }}
            >
              <span className="landing-feature-icon" aria-hidden="true">
                <feat.icon className="w-6 h-6" />
              </span>
              <h3>{feat.title}</h3>
              <p>{feat.desc}</p>
            </article>
          ))}
        </div>
      </section>

      <footer className="landing-footer">
        <div>
          <strong>OrbionX</strong>
          <span>AI Space Intelligence Platform</span>
        </div>
        <div>
          <span>Celestrak</span>
          <span>SGP4</span>
          <span>ML Prediction</span>
        </div>
      </footer>
    </div>
  );
}
