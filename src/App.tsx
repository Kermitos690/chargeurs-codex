import { lazy, Suspense } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, HashRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { I18nProvider } from "@/i18n/i18n";

const Index = lazy(() => import("./pages/Index.tsx"));
const NotFound = lazy(() => import("./pages/NotFound.tsx"));
const Kiosk = lazy(() => import("./pages/Kiosk.tsx"));
const KioskHome = lazy(() => import("./pages/KioskHome.tsx"));
const Pay = lazy(() => import("./pages/Pay.tsx"));
const CityPowerbank = lazy(() => import("./pages/CityPowerbank.tsx"));
const Partners = lazy(() => import("./pages/Partners.tsx"));
const Support = lazy(() => import("./pages/Support.tsx"));
const AccountAuth = lazy(() => import("./pages/account/AccountAuth.tsx"));
const AccountLayout = lazy(() => import("./pages/account/AccountLayout.tsx"));
const AccountDashboard = lazy(() => import("./pages/account/AccountDashboard.tsx"));
const AccountResetPassword = lazy(() => import("./pages/account/AccountResetPassword.tsx"));
const AdminAuth = lazy(() => import("./pages/admin/AdminAuth.tsx"));
const ResetPassword = lazy(() => import("./pages/admin/ResetPassword.tsx"));
const AdminUsers = lazy(() => import("./pages/admin/AdminUsers.tsx"));
const AdminKioskDevices = lazy(() => import("./pages/admin/AdminKioskDevices.tsx"));
const AdminLayout = lazy(() => import("./pages/admin/AdminLayout.tsx"));
const AdminOverview = lazy(() => import("./pages/admin/AdminOverview.tsx"));
const AdminStations = lazy(() => import("./pages/admin/AdminStations.tsx"));
const AdminStationDetail = lazy(() => import("./pages/admin/AdminStationDetail.tsx"));
const AdminPayments = lazy(() => import("./pages/admin/AdminPayments.tsx"));
const AdminRentals = lazy(() => import("./pages/admin/AdminRentals.tsx"));
const AdminEvents = lazy(() => import("./pages/admin/AdminEvents.tsx"));
const AdminSettings = lazy(() => import("./pages/admin/AdminSettings.tsx"));
const AdminMaintenance = lazy(() => import("./pages/admin/AdminMaintenance.tsx"));
const AdminApiHealth = lazy(() => import("./pages/admin/AdminApiHealth.tsx"));
const AdminApiCoverage = lazy(() => import("./pages/admin/AdminApiCoverage.tsx"));
const AdminOrders = lazy(() => import("./pages/admin/AdminOrders.tsx"));
const AdminPricing = lazy(() => import("./pages/admin/AdminPricing.tsx"));
const AdminPricingDetail = lazy(() => import("./pages/admin/AdminPricingDetail.tsx"));
const AdminShops = lazy(() => import("./pages/admin/AdminShops.tsx"));
const AdminPartners = lazy(() => import("./pages/admin/AdminPartners.tsx"));
const AdminRentalFlowHealth = lazy(() => import("./pages/admin/AdminRentalFlowHealth.tsx"));
const AdminTestMonitor = lazy(() => import("./pages/admin/AdminTestMonitor.tsx"));

const queryClient = new QueryClient();
const Router = import.meta.env.VITE_ROUTER_MODE === "hash" ? HashRouter : BrowserRouter;

function RouteFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-6 text-center text-sm text-muted-foreground">
      Chargement de Chargeurs.ch…
    </div>
  );
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <I18nProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <Router>
          <Suspense fallback={<RouteFallback />}>
            <Routes>
              <Route path="/" element={<Index />} />
              <Route path="/powerbank/:citySlug" element={<CityPowerbank />} />
              <Route path="/partenaires" element={<Partners />} />
              <Route path="/support" element={<Support />} />
              <Route path="/kiosk" element={<KioskHome />} />
              <Route path="/kiosk/:stationId" element={<Kiosk />} />
              <Route path="/kiosk/station/:stationId" element={<Kiosk />} />
              <Route path="/pay/:rentalSessionId" element={<Pay />} />
              <Route path="/pay/:rentalSessionId/success" element={<Pay />} />
              <Route path="/pay/:rentalSessionId/cancel" element={<Pay />} />
              <Route path="/compte/login" element={<AccountAuth />} />
              <Route path="/compte/reset-password" element={<AccountResetPassword />} />
              <Route path="/compte" element={<AccountLayout />}>
                <Route index element={<AccountDashboard />} />
              </Route>
              <Route path="/admin/login" element={<AdminAuth />} />
              <Route path="/admin/reset-password" element={<ResetPassword />} />

              <Route path="/admin" element={<AdminLayout />}>
                <Route index element={<AdminOverview />} />
                <Route path="stations" element={<AdminStations />} />
                <Route path="stations/:stationId" element={<AdminStationDetail />} />
                <Route path="payments" element={<AdminPayments />} />
                <Route path="rentals" element={<AdminRentals />} />
                <Route path="orders" element={<AdminOrders />} />
                <Route path="pricing" element={<AdminPricing />} />
                <Route path="pricing/:id" element={<AdminPricingDetail />} />
                <Route path="partners" element={<AdminPartners />} />
                <Route path="shops" element={<AdminShops />} />
                <Route path="rental-flow-health" element={<AdminRentalFlowHealth />} />
                <Route path="test-monitor" element={<AdminTestMonitor />} />
                <Route path="events" element={<AdminEvents />} />
                <Route path="settings" element={<AdminSettings />} />
                <Route path="users" element={<AdminUsers />} />
                <Route path="kiosk-devices" element={<AdminKioskDevices />} />
                <Route path="maintenance" element={<AdminMaintenance />} />
                <Route path="api-health" element={<AdminApiHealth />} />
                <Route path="api-coverage" element={<AdminApiCoverage />} />
              </Route>
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        </Router>
      </TooltipProvider>
    </I18nProvider>
  </QueryClientProvider>
);

export default App;
