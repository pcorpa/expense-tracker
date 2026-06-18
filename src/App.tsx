import { lazy, Suspense, useEffect, useState } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "./lib/auth";
import { ThemeProvider } from "./lib/theme";
import { NavBar } from "./components/NavBar";
import { MobileMenu } from "./components/MobileMenu";
import { useAuth } from "./lib/auth";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { PublicOnlyRoute } from "./components/PublicOnlyRoute";
import "./App.css";

const Home                  = lazy(() => import("./pages/Home"));
const SignIn                 = lazy(() => import("./pages/SignIn"));
const SignUp                 = lazy(() => import("./pages/SignUp"));
const UploadReceipt          = lazy(() => import("./pages/UploadReceipt"));
const ExpenseList            = lazy(() => import("./pages/ExpenseList"));
const ReviewQueue            = lazy(() => import("./pages/ReviewQueue"));
const ReviewItemEdit         = lazy(() => import("./pages/ReviewItemEdit"));
const ReviewTransactionEdit  = lazy(() => import("./pages/ReviewTransactionEdit"));
const Profile                = lazy(() => import("./pages/Profile"));
const TransactionEntry       = lazy(() => import("./pages/TransactionEntry"));
const GroupManager           = lazy(() => import("./pages/GroupManager"));
const Analytics              = lazy(() => import("./pages/Analytics"));
const ProductAudit           = lazy(() => import("./pages/ProductAudit"));
const VendorAudit            = lazy(() => import("./pages/VendorAudit"));
const Invitations            = lazy(() => import("./pages/Invitations"));
const RecurringExpenses      = lazy(() => import("./pages/RecurringExpenses"));
const AddRecurringExpense    = lazy(() => import("./pages/AddRecurringExpense"));
const EditRecurringExpense   = lazy(() => import("./pages/EditRecurringExpense"));
const ShoppingList           = lazy(() => import("./pages/ShoppingList"));

const queryClient = new QueryClient();

function AppShell() {
  const { user, signOut } = useAuth();
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(max-width: 800px)");
    const handleResize = () => setIsMobile(mediaQuery.matches);
    handleResize();
    mediaQuery.addEventListener("change", handleResize);
    return () => mediaQuery.removeEventListener("change", handleResize);
  }, []);

  return (
    <div className="app-shell">
      {isMobile ? <MobileMenu user={user} signOut={signOut} /> : <NavBar />}
      <div className="app-shell__content">
        <Suspense fallback={<main className="page" />}>
        <Routes>
          <Route path="/signin" element={<PublicOnlyRoute><SignIn /></PublicOnlyRoute>} />
          <Route path="/signup" element={<PublicOnlyRoute><SignUp /></PublicOnlyRoute>} />
          <Route
            path="/"
            element={
              <ProtectedRoute>
                <Home />
              </ProtectedRoute>
            }
          />
          <Route
            path="/transactions"
            element={
              <ProtectedRoute>
                <ExpenseList />
              </ProtectedRoute>
            }
          />
          <Route
            path="/upload"
            element={
              <ProtectedRoute>
                <UploadReceipt />
              </ProtectedRoute>
            }
          />
          <Route
            path="/entry"
            element={
              <ProtectedRoute>
                <TransactionEntry />
              </ProtectedRoute>
            }
          />
          <Route
            path="/review"
            element={
              <ProtectedRoute>
                <ReviewQueue />
              </ProtectedRoute>
            }
          />
          <Route
            path="/review/:transactionId/items/:itemId"
            element={
              <ProtectedRoute>
                <ReviewItemEdit />
              </ProtectedRoute>
            }
          />
          <Route
            path="/review/:transactionId/edit"
            element={
              <ProtectedRoute>
                <ReviewTransactionEdit />
              </ProtectedRoute>
            }
          />
          <Route
            path="/groups"
            element={
              <ProtectedRoute>
                <GroupManager />
              </ProtectedRoute>
            }
          />
          <Route
            path="/analytics"
            element={
              <ProtectedRoute>
                <Analytics />
              </ProtectedRoute>
            }
          />
          <Route
            path="/product-audit"
            element={
              <ProtectedRoute>
                <ProductAudit />
              </ProtectedRoute>
            }
          />
          <Route
            path="/vendor-audit"
            element={
              <ProtectedRoute>
                <VendorAudit />
              </ProtectedRoute>
            }
          />
          <Route
            path="/invitations"
            element={
              <ProtectedRoute>
                <Invitations />
              </ProtectedRoute>
            }
          />
          <Route
            path="/recurring"
            element={
              <ProtectedRoute>
                <RecurringExpenses />
              </ProtectedRoute>
            }
          />
          <Route
            path="/recurring/new"
            element={
              <ProtectedRoute>
                <AddRecurringExpense />
              </ProtectedRoute>
            }
          />
          <Route
            path="/recurring/:id/edit"
            element={
              <ProtectedRoute>
                <EditRecurringExpense />
              </ProtectedRoute>
            }
          />
          <Route
            path="/shopping-list"
            element={
              <ProtectedRoute>
                <ShoppingList />
              </ProtectedRoute>
            }
          />
          <Route
            path="/profile"
            element={
              <ProtectedRoute>
                <Profile />
              </ProtectedRoute>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        </Suspense>
      </div>
    </div>
  );
}

function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <QueryClientProvider client={queryClient}>
          <BrowserRouter>
            <AppShell />
          </BrowserRouter>
        </QueryClientProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}

export default App;
