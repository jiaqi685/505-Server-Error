import { type ReactNode, useEffect, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useQueryClient } from "@tanstack/react-query";
import { Redirect, Route, Switch, useLocation, Router as WouterRouter } from "wouter";
import { ErrorBoundary } from "@/components/error-boundary";
import { AppShell } from "@/components/layout/app-shell";
import { setCurrentDemoUser } from "@/data";
import { ModalProvider } from "@/components/modals/modal-context";
import { ModalRoot } from "@/components/modals/modal-root";
import { ToastProvider } from "@/components/shared/toast";
import { useAuth } from "@/lib/use-auth";
import HomePage from "@/pages/home";
import PurchasingPage from "@/pages/purchasing";
import ProductDetailPage from "@/pages/product-detail";
import OrdersPage from "@/pages/orders";
import ActivityPage from "@/pages/activity";
import FlaskProductsDiagnosticPage from "@/pages/flask-products-diagnostic";
import PosImportPage from "@/pages/pos-import";
import SupplierQuotationsPage from "@/pages/supplier-quotations";
import NotFound from "@/pages/not-found";

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false, retry: 1 } },
});

function Router() {
  return (
    <RoutedErrorBoundary>
      <Switch>
        <Route path="/" component={HomePage} />
        <Route path="/purchasing" component={PurchasingPage} />
        <Route path="/purchasing/:productId" component={ProductDetailPage} />
        <Route path="/supplier-quotations" component={SupplierQuotationsPage} />
        {/* Old links keep working */}
        <Route path="/automation">{() => <Redirect to="/purchasing" replace />}</Route>
        <Route path="/automation/:productId">{(params) => <Redirect to={`/purchasing/${params.productId}`} replace />}</Route>
        <Route path="/orders" component={OrdersPage} />
        <Route path="/activity" component={ActivityPage} />
        <Route path="/pos-import" component={PosImportPage} />
        {import.meta.env.DEV && <Route path="/dev/flask-products" component={FlaskProductsDiagnosticPage} />}
        <Route component={NotFound} />
      </Switch>
    </RoutedErrorBoundary>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthenticatedApp />
    </QueryClientProvider>
  );
}

function AuthenticatedApp() {
  const auth = useAuth();
  const client = useQueryClient();
  const [initializedUser, setInitializedUser] = useState<string | null>(null);

  useEffect(() => {
    const id = auth.user?.id ?? "anonymous";
    setCurrentDemoUser(id);
    client.clear();
    setInitializedUser(auth.user?.id ?? null);
  }, [auth.user?.id, client]);

  if (auth.isLoading || (auth.user && initializedUser !== auth.user.id)) {
    return <div className="auth-screen ngate-glass"><div className="auth-card"><div className="brand-mark">N</div><p>Loading your account…</p></div></div>;
  }
  if (!auth.user) {
    return (
      <div className="auth-screen ngate-glass">
        <div className="auth-card">
          <div className="brand-mark">N</div>
          <p className="eyebrow">PURCHASING ASSISTANT</p>
          <h1>Welcome to NGate</h1>
          <p>{auth.loadError ? "Sign-in could not be reached. Check your connection and try again." : "Sign in to view your purchasing workspace and private quotations."}</p>
          <button className="btn primary" onClick={auth.login}>{auth.loadError ? "Try sign-in again" : "Log in"}</button>
          <small>Only your account can access its uploaded quotation files.</small>
        </div>
      </div>
    );
  }

  const userName = [auth.user.firstName, auth.user.lastName].filter(Boolean).join(" ") || auth.user.email || "Account";
  return (
    <ToastProvider>
      <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
        <ModalProvider>
          <div className="ngate-glass">
            <AppShell onLogout={auth.logout} userName={userName}>
              <Router />
            </AppShell>
            <ModalRoot />
          </div>
        </ModalProvider>
      </WouterRouter>
    </ToastProvider>
  );
}

export default App;
