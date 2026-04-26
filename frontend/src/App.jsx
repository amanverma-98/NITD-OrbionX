import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Component, lazy, Suspense, useEffect, useState } from 'react';
import { Satellite, TriangleAlert } from 'lucide-react';
import Layout from './components/Layout';
import { supabase, signInWithGoogle, signOutUser } from './services/supabase';
import './index.css';

const Landing = lazy(() => import('./pages/Landing'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Visualization = lazy(() => import('./pages/Visualization'));
const Collisions = lazy(() => import('./pages/Collisions'));
const Prediction = lazy(() => import('./pages/Prediction'));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 2,
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 5000),
      refetchOnWindowFocus: false,
      refetchOnMount: false,
      refetchOnReconnect: false,
      staleTime: Infinity,
      cacheTime: Infinity,
    },
  },
});

// Error Boundary Component
class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('Error caught by boundary:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
          <div className="text-center px-6">
            <div className="flex justify-center mb-6">
              <TriangleAlert className="w-14 h-14 text-red-300" />
            </div>
            <h1 className="text-4xl font-bold gradient-text mb-4">Something went wrong</h1>
            <p className="text-slate-400 mb-8 max-w-md">
              We encountered an unexpected error. Try refreshing the page or contact support.
            </p>
            <button
              onClick={() => window.location.reload()}
              className="px-8 py-3 bg-gradient-to-r from-cyan-500 to-purple-600 text-white rounded-lg font-semibold hover:scale-105 transition-transform"
            >
              Refresh Page
            </button>
            <p className="text-xs text-slate-600 mt-6 font-mono">
              {this.state.error?.message}
            </p>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

function AppContent() {
  const [session, setSession] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState('');

  useEffect(() => {
    let mounted = true;

    const initSession = async () => {
      if (!supabase) {
        if (mounted) {
          setSession(null);
          setAuthLoading(false);
        }
        return;
      }

      const { data } = await supabase.auth.getSession();
      if (mounted) {
        setSession(data.session);
        setAuthLoading(false);
      }
    };

    initSession();

    if (!supabase) {
      return () => {
        mounted = false;
      };
    }

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (mounted) {
        setSession(nextSession);
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const handleGoogleSignIn = async () => {
    setAuthError('');
    const { error } = await signInWithGoogle();
    if (error) {
      setAuthError(error.message || 'Unable to start Google sign-in.');
    }
  };

  const handleSignOut = async () => {
    setAuthError('');
    const { error } = await signOutUser();
    if (error) {
      setAuthError(error.message || 'Unable to sign out.');
    }
  };

  const protectRoute = (element) => {
    if (authLoading) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
          <div className="text-center">
            <div className="flex justify-center mb-3">
              <Satellite className="w-10 h-10 text-cyan-300" />
            </div>
            <p className="text-slate-300 font-semibold">Checking authentication…</p>
          </div>
        </div>
      );
    }
    if (!session) {
      return <Navigate to="/" replace />;
    }
    return element;
  };

  return (
    <Suspense
      fallback={(
        <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
          <div className="text-center">
            <div className="flex justify-center mb-3">
              <Satellite className="w-10 h-10 text-cyan-300" />
            </div>
            <p className="text-slate-300 font-semibold">Loading OrbionX…</p>
          </div>
        </div>
      )}
    >
      <Routes>
        <Route
          path="/"
          element={(
            <Landing
              session={session}
              authError={authError}
              onGoogleSignIn={handleGoogleSignIn}
              authLoading={authLoading}
            />
          )}
        />
        <Route element={<Layout session={session} onSignOut={handleSignOut} />}>
          <Route path="/dashboard" element={protectRoute(<Dashboard />)} />
          <Route path="/visualization" element={<Visualization />} />
          <Route path="/collisions" element={protectRoute(<Collisions />)} />
          <Route path="/prediction" element={protectRoute(<Prediction />)} />
        </Route>
      </Routes>
    </Suspense>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <Router>
          <AppContent />
        </Router>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
