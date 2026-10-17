import React, { lazy, Suspense, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Login } from './pages/Login';
import { startCategorySync, useServiceCategories } from './store/useServiceCategories';
import { useStore } from './store/useStore';
import { isSupabaseConfigured } from './api/supabase';
import { startAppSettingsSync, useAppSettings } from './store/useAppSettings';
import { warmReceiptAssetsCache } from './hooks/useReceiptAssets';

const POS=lazy(()=>import('./pages/POS').then(module=>({default:module.POS})));
const Dashboard=lazy(()=>import('./pages/Dashboard').then(module=>({default:module.Dashboard})));
const Settings=lazy(()=>import('./pages/Settings').then(module=>({default:module.Settings})));
const Customers=lazy(()=>import('./pages/Customers').then(module=>({default:module.Customers})));
const Invoices=lazy(()=>import('./pages/Invoices').then(module=>({default:module.Invoices})));
const Statistics=lazy(()=>import('./pages/Statistics').then(module=>({default:module.Statistics})));

const ProtectedRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isAuthenticated, syncData } = useStore();

  useEffect(() => {
    if (isAuthenticated && isSupabaseConfigured()) {
      syncData();
    }
  }, [isAuthenticated, syncData]);
  useEffect(() => {
    if (isAuthenticated) return startCategorySync();
  }, [isAuthenticated]);
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }
  return <>{children}</>;
};

function App() {
  useEffect(()=>startAppSettingsSync(),[]);
  useEffect(() => {
    void warmReceiptAssetsCache();
  }, []);

  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      const state = useStore.getState();
      if (state.pendingMutations.length > 0 || useServiceCategories.getState().isSaving || useAppSettings.getState().isSaving) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, []);

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          path="/*"
          element={
            <ProtectedRoute>
              <Layout>
                <Suspense fallback={<div role="status" className="page-loading"><span/>Opening your workspace...</div>}>
                <Routes>
                  <Route path="/" element={<POS />} />
                  <Route path="/dashboard" element={<Dashboard />} />
                  <Route path="/invoices" element={<Invoices />} />
                  <Route path="/customers" element={<Customers />} />
                  <Route path="/settings" element={<Settings />} />
                  <Route path="/statistics" element={<Statistics />} />
                </Routes>
                </Suspense>
              </Layout>
            </ProtectedRoute>
          }
        />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
