import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, HashRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { I18nProvider } from "@/i18n/i18n";
import Index from "./pages/Index.tsx";
import NotFound from "./pages/NotFound.tsx";
import KioskPremiumGateV3 from "./pages/KioskPremiumGateV3.tsx";
import KioskHome from "./pages/KioskHome.tsx";
import Pay from "./pages/Pay.tsx";
import PaymentChoice from "./pages/PaymentChoice.tsx";
import RentalProgress from "./pages/RentalProgress.tsx";
import { KioskReturnOverlay } from "./components/kiosk/KioskReturnOverlay.tsx";
import { KioskHelpLauncher } from "./components/kiosk/KioskHelpLauncher.tsx";
import { KioskOffersLauncher } from "./components/kiosk/KioskOffersLauncher.tsx";
import { KioskOperationalGuard } from "./components/kiosk/KioskOperationalGuard.tsx";
import CityPowerbank from "./pages/CityPowerbank.tsx";
import Partners from "./pages/Partners.tsx";
import Support from "./pages/Support.tsx";
import PublicStation from "./pages/public/PublicStation.tsx";
import AccountAuth from "./pages/account/AccountAuth.tsx";
import AccountLayout from "./pages/account/AccountLayout.tsx";
import AccountHome from "./pages/account/AccountHome.tsx";
import AccountRentals from "./pages/account/AccountRentals.tsx";
import AccountPayments from "./pages/account/AccountPayments.tsx";
import AccountPass from "./pages/account/AccountPass.tsx";
import AccountSupport from "./pages/account/AccountSupport.tsx";
import AccountProfile from "./pages/account/AccountProfile.tsx";
import AccountResetPassword from "./pages/account/AccountResetPassword.tsx";
import AccountConnect from "./pages/account/AccountConnect.tsx";
import AccountScanner from "./pages/account/AccountScanner.tsx";
import AdminAuth from "./pages/admin/AdminAuth.tsx";
import ResetPassword from "./pages/admin/ResetPassword.tsx";
import AdminUsers from "./pages/admin/AdminUsers.tsx";
import AdminKioskDevices from "./pages/admin/AdminKioskDevices.tsx";
import AdminLayout from "./pages/admin/AdminLayout.tsx";
import AdminOverview from "./pages/admin/AdminOverview.tsx";
import AdminStations from "./pages/admin/AdminStations.tsx";
import AdminStationDetail from "./pages/admin/AdminStationDetail.tsx";
import AdminRemoteKiosk from "./pages/admin/AdminRemoteKiosk.tsx";
import AdminPayments from "./pages/admin/AdminPayments.tsx";
import AdminRentals from "./pages/admin/AdminRentals.tsx";
import AdminEvents from "./pages/admin/AdminEvents.tsx";
import AdminSettings from "./pages/admin/AdminSettings.tsx";
import AdminMaintenance from "./pages/admin/AdminMaintenance.tsx";
import AdminApiHealth from "./pages/admin/AdminApiHealth.tsx";
import AdminApiCoverage from "./pages/admin/AdminApiCoverage.tsx";
import AdminOrders from "./pages/admin/AdminOrders.tsx";
import AdminPricing from "./pages/admin/AdminPricing.tsx";
import AdminPricingDetail from "./pages/admin/AdminPricingDetail.tsx";
import AdminShops from "./pages/admin/AdminShops.tsx";
import AdminPartners from "./pages/admin/AdminPartners.tsx";
import AdminRentalFlowHealth from "./pages/admin/AdminRentalFlowHealth.tsx";
import AdminTestMonitor from "./pages/admin/AdminTestMonitor.tsx";
import AdminApiClients from "./pages/admin/AdminApiClients.tsx";
import AdminBatteryQualification from "./pages/admin/AdminBatteryQualification.tsx";
import AdminCustomerProgram from "./pages/admin/AdminCustomerProgram.tsx";
import AdminAdvertising from "./pages/admin/AdminAdvertising.tsx";
import AdminInventory from "./pages/admin/AdminInventory.tsx";
import "./pages/admin/admin-advertising.css";
import LegalPage from "./pages/LegalPage.tsx";

const queryClient = new QueryClient();
const Router = import.meta.env.VITE_ROUTER_MODE === "hash" ? HashRouter : BrowserRouter;

const App = () => (
  <QueryClientProvider client={queryClient}>
    <I18nProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <Router>
          <KioskReturnOverlay />
          <KioskHelpLauncher />
          <KioskOffersLauncher />
          <KioskOperationalGuard />
          <Routes>
            <Route path="/" element={<Index />} />
            <Route path="/powerbank/:citySlug" element={<CityPowerbank />} />
            <Route path="/partenaires" element={<Partners />} />
            <Route path="/support" element={<Support />} />
            <Route path="/bornes/:stationId" element={<PublicStation />} />
            <Route path="/legal/:kind" element={<LegalPage />} />
            <Route path="/kiosk" element={<KioskHome />} />
            <Route path="/kiosk/:stationId" element={<KioskPremiumGateV3 />} />
            <Route path="/kiosk/station/:stationId" element={<KioskPremiumGateV3 />} />
            <Route path="/pay/:rentalSessionId/choose" element={<PaymentChoice />} />
            <Route path="/pay/:rentalSessionId/progress" element={<RentalProgress />} />
            <Route path="/pay/:rentalSessionId" element={<Pay />} />
            <Route path="/pay/:rentalSessionId/success" element={<Pay />} />
            <Route path="/pay/:rentalSessionId/cancel" element={<Pay />} />
            <Route path="/compte/login" element={<AccountAuth />} />
            <Route path="/compte/reset-password" element={<AccountResetPassword />} />
            <Route path="/compte/connect/:token" element={<AccountConnect />} />
            <Route path="/compte/scanner" element={<AccountScanner />} />
            <Route path="/compte" element={<AccountLayout />}>
              <Route index element={<AccountHome />} />
              <Route path="locations" element={<AccountRentals />} />
              <Route path="paiements" element={<AccountPayments />} />
              <Route path="pass" element={<AccountPass />} />
              <Route path="support" element={<AccountSupport />} />
              <Route path="profil" element={<AccountProfile />} />
            </Route>
            <Route path="/admin/login" element={<AdminAuth />} />
            <Route path="/admin/reset-password" element={<ResetPassword />} />
            <Route path="/admin" element={<AdminLayout />}>
              <Route index element={<AdminOverview />} />
              <Route path="stations" element={<AdminStations />} />
              <Route path="stations/:stationId" element={<AdminStationDetail />} />
              <Route path="remote-kiosk" element={<AdminRemoteKiosk />} />
              <Route path="payments" element={<AdminPayments />} />
              <Route path="rentals" element={<AdminRentals />} />
              <Route path="orders" element={<AdminOrders />} />
              <Route path="pricing" element={<AdminPricing />} />
              <Route path="pricing/:id" element={<AdminPricingDetail />} />
              <Route path="customer-program" element={<AdminCustomerProgram />} />
              <Route path="partners" element={<AdminPartners />} />
              <Route path="shops" element={<AdminShops />} />
              <Route path="advertising" element={<AdminAdvertising />} />
              <Route path="inventory" element={<AdminInventory />} />
              <Route path="rental-flow-health" element={<AdminRentalFlowHealth />} />
              <Route path="test-monitor" element={<AdminTestMonitor />} />
              <Route path="battery-qualification" element={<AdminBatteryQualification />} />
              <Route path="events" element={<AdminEvents />} />
              <Route path="settings" element={<AdminSettings />} />
              <Route path="users" element={<AdminUsers />} />
              <Route path="kiosk-devices" element={<AdminKioskDevices />} />
              <Route path="api-clients" element={<AdminApiClients />} />
              <Route path="maintenance" element={<AdminMaintenance />} />
              <Route path="api-health" element={<AdminApiHealth />} />
              <Route path="api-coverage" element={<AdminApiCoverage />} />
            </Route>
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Router>
      </TooltipProvider>
    </I18nProvider>
  </QueryClientProvider>
);

export default App;
