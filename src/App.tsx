import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import ProtectedRoute from "@/components/ProtectedRoute";
import AdminRoute from "@/components/AdminRoute";

// Public pages
import Index from "./pages/Index";
import Login from "./pages/Login";
import OAuthConsent from "./pages/OAuthConsent";
import Register from "./pages/Register";
import ForgotPassword from "./pages/ForgotPassword";
import ResetPassword from "./pages/ResetPassword";
import GiftCard from "./pages/GiftCard";
import NotFound from "./pages/NotFound";

// Test flow (no auth)
import TestLanding from "./pages/TestLanding";
import TestRecording from "./pages/TestRecording";
import TestUpload from "./pages/TestUpload";
import TestResult from "./pages/TestResult";

// Protected pages
import Dashboard from "./pages/Dashboard";
import CreateBook from "./pages/CreateBook";
import EditBook from "./pages/EditBook";
import GuidedInterview from "./pages/GuidedInterview";
import BookEditor from "./pages/BookEditor";
import BookPreview from "./pages/BookPreview";
import ExportPage from "./pages/ExportPage";
import PrintOrderPage from "./pages/PrintOrderPage";
import ProfilePage from "./pages/ProfilePage";
import AdminPanel from "./pages/AdminPanel";
import HelpCenter from "./pages/HelpCenter";
import ContactSupport from "./pages/ContactSupport";
import PaymentSuccess from "./pages/PaymentSuccess";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            {/* Public */}
            <Route path="/" element={<Index />} />
            <Route path="/logga-in" element={<Login />} />
            <Route path="/.lovable/oauth/consent" element={<OAuthConsent />} />
            <Route path="/registrera" element={<Register />} />
            <Route path="/glomt-losenord" element={<ForgotPassword />} />
            <Route path="/aterstall-losenord" element={<ResetPassword />} />
            <Route path="/presentkort" element={<GiftCard />} />
            <Route path="/hjalp" element={<HelpCenter />} />
            <Route path="/kontakta-support" element={<ProtectedRoute><ContactSupport /></ProtectedRoute>} />
            {/* Test flow (no auth) */}
            <Route path="/test" element={<TestLanding />} />
            <Route path="/test-spela-in" element={<TestRecording />} />
            <Route path="/test-ladda-upp" element={<TestUpload />} />
            <Route path="/test-resultat" element={<TestResult />} />

            {/* Protected */}
            <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
            <Route path="/skapa-bok" element={<ProtectedRoute><CreateBook /></ProtectedRoute>} />
            <Route path="/bok/:bookId/edit" element={<ProtectedRoute><EditBook /></ProtectedRoute>} />
            <Route path="/bok/:bookId/intervju/:themeId" element={<ProtectedRoute><GuidedInterview /></ProtectedRoute>} />
            <Route path="/bok/:bookId" element={<ProtectedRoute><BookEditor /></ProtectedRoute>} />
            <Route path="/bok/:bookId/preview" element={<ProtectedRoute><BookPreview /></ProtectedRoute>} />
            <Route path="/bok/:bookId/export" element={<ProtectedRoute><ExportPage /></ProtectedRoute>} />
            <Route path="/bestall/:bookId" element={<ProtectedRoute><PrintOrderPage /></ProtectedRoute>} />
            <Route path="/profil" element={<ProtectedRoute><ProfilePage /></ProtectedRoute>} />
            <Route path="/betalning-klar" element={<ProtectedRoute><PaymentSuccess /></ProtectedRoute>} />
            <Route path="/admin" element={<AdminRoute><AdminPanel /></AdminRoute>} />

            {/* Catch-all */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
