import { useEffect, useState } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "./lib/auth";
import { NavBar } from "./components/NavBar";
import { MobileMenu } from "./components/MobileMenu";
import { useAuth } from "./lib/auth";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { PublicOnlyRoute } from "./components/PublicOnlyRoute";
import { Home } from "./pages/Home";
import { SignIn } from "./pages/SignIn";
import { SignUp } from "./pages/SignUp";
import { UploadReceipt } from "./pages/UploadReceipt";
import { ExpenseList } from "./pages/ExpenseList";
import { ReviewQueue } from "./pages/ReviewQueue";
import { ReviewItemEdit } from "./pages/ReviewItemEdit";
import { ReviewTransactionEdit } from "./pages/ReviewTransactionEdit";
import { Profile } from "./pages/Profile";
import { TransactionEntry } from "./pages/TransactionEntry";
import { GroupManager } from "./pages/GroupManager";
import { Analytics } from "./pages/Analytics";
import { ProductAudit } from "./pages/ProductAudit";
import { VendorAudit } from "./pages/VendorAudit";
import { Invitations } from "./pages/Invitations";
import { RecurringExpenses } from "./pages/RecurringExpenses";
import { AddRecurringExpense } from "./pages/AddRecurringExpense";
import { EditRecurringExpense } from "./pages/EditRecurringExpense";
import { ShoppingList } from "./pages/ShoppingList";
import "./App.css";

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
      </div>
    </div>
  );
}

function App() {
  return (
    <AuthProvider>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <AppShell />
        </BrowserRouter>
      </QueryClientProvider>
    </AuthProvider>
  );
}

export default App;
