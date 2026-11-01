import React, { Suspense, lazy } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './hooks/useAuth';
import { AppLayout } from './layouts/AppLayout';
import { LoadingIndicator } from './components/common/StatusBadge';
import { ErrorBoundary } from './components/common/ErrorBoundary';

// Route-level code splitting: each page (and the MediaPipe library behind the camera) is downloaded only when first needed.
const LoginPage = lazy(() => import('./pages/LoginPage').then((m) => ({ default: m.LoginPage })));
const RegisterPage = lazy(() => import('./pages/RegisterPage').then((m) => ({ default: m.RegisterPage })));
const DashboardPage = lazy(() => import('./pages/DashboardPage').then((m) => ({ default: m.DashboardPage })));
const ClassroomDetailPage = lazy(() => import('./pages/ClassroomDetailPage').then((m) => ({ default: m.ClassroomDetailPage })));
const LiveClassroomPage = lazy(() => import('./pages/LiveClassroomPage').then((m) => ({ default: m.LiveClassroomPage })));
const TranscriptPage = lazy(() => import('./pages/TranscriptPage').then((m) => ({ default: m.TranscriptPage })));
const AccountPage = lazy(() => import('./pages/AccountPage').then((m) => ({ default: m.AccountPage })));
const DemoPage = lazy(() => import('./pages/DemoPage').then((m) => ({ default: m.DemoPage })));

function ProtectedRoute({ children }) {
  const { isAuthenticated, loading } = useAuth();
  const location = useLocation();
  if (loading) return <LoadingIndicator text="Verifying session…" />;
  if (!isAuthenticated) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return children;
}

function PublicOnlyRoute({ children }) {
  const { isAuthenticated, loading } = useAuth();
  const location = useLocation();
  if (loading) return <LoadingIndicator text="Loading…" />;
  if (isAuthenticated) return <Navigate to={location.state?.from || '/dashboard'} replace />;
  return children;
}

export function App() {
  const location = useLocation();
  return (
    <ErrorBoundary resetKey={location.pathname}>
      <Suspense fallback={<LoadingIndicator text="Loading…" />}>
        <Routes>
          <Route element={<AppLayout />}>
            <Route path="/login" element={<PublicOnlyRoute><LoginPage /></PublicOnlyRoute>} />
            <Route path="/register" element={<PublicOnlyRoute><RegisterPage /></PublicOnlyRoute>} />
            <Route path="/demo" element={<DemoPage />} />
            <Route path="/dashboard" element={<ProtectedRoute><DashboardPage /></ProtectedRoute>} />
            <Route path="/classrooms/:id" element={<ProtectedRoute><ClassroomDetailPage /></ProtectedRoute>} />
            <Route path="/classrooms/:id/live" element={<ProtectedRoute><LiveClassroomPage /></ProtectedRoute>} />
            <Route path="/transcripts/:id" element={<ProtectedRoute><TranscriptPage /></ProtectedRoute>} />
            <Route path="/account" element={<ProtectedRoute><AccountPage /></ProtectedRoute>} />
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Route>
        </Routes>
      </Suspense>
    </ErrorBoundary>
  );
}

export default App;
