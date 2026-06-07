import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { I18nProvider } from "@/i18n/i18n";
import Index from "./pages/Index.tsx";
import NotFound from "./pages/NotFound.tsx";
import Kiosk from "./pages/Kiosk.tsx";
import Pay from "./pages/Pay.tsx";
import AdminAuth from "./pages/admin/AdminAuth.tsx";
import AdminLayout from "./pages/admin/AdminLayout.tsx";
import AdminOverview from "./pages/admin/AdminOverview.tsx";
import AdminStations from "./pages/admin/AdminStations.tsx";
import AdminStationDetail from "./pages/admin/AdminStationDetail.tsx";
import AdminPayments from "./pages/admin/AdminPayments.tsx";
import AdminRentals from "./pages/admin/AdminRentals.tsx";
import AdminEvents from "./pages/admin/AdminEvents.tsx";
import AdminSettings from "./pages/admin/AdminSettings.tsx";
import AdminMaintenance from "./pages/admin/AdminMaintenance.tsx";
import AdminApiHealth from "./pages/admin/AdminApiHealth.tsx";
import AdminApiCoverage from "./pages/admin/AdminApiCoverage.tsx";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <I18nProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Index />} />
            <Route path="/kiosk/:stationId" element={<Kiosk />} />
            <Route path="/pay/:rentalSessionId" element={<Pay />} />
            <Route path="/pay/:rentalSessionId/success" element={<Pay />} />
            <Route path="/pay/:rentalSessionId/cancel" element={<Pay />} />
            <Route path="/admin/login" element={<AdminAuth />} />
            <Route path="/admin" element={<AdminLayout />}>
              <Route index element={<AdminOverview />} />
              <Route path="stations" element={<AdminStations />} />
              <Route path="stations/:stationId" element={<AdminStationDetail />} />
              <Route path="payments" element={<AdminPayments />} />
              <Route path="rentals" element={<AdminRentals />} />
              <Route path="events" element={<AdminEvents />} />
              <Route path="settings" element={<AdminSettings />} />
              <Route path="maintenance" element={<AdminMaintenance />} />
              <Route path="api-health" element={<AdminApiHealth />} />
              <Route path="api-coverage" element={<AdminApiCoverage />} />
            </Route>
            {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </I18nProvider>
  </QueryClientProvider>
);

export default App;
