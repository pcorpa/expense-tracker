import { lazy } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "./lib/auth";
import { ThemeProvider } from "./lib/theme";
import { AppLayout } from "./components/AppLayout";
import { PublicLayout } from "./components/PublicLayout";
import { PublicOnlyRoute } from "./components/PublicOnlyRoute";
import "./App.css";

const LandingPage            = lazy(() => import("./pages/LandingPage"));
const PricingPage            = lazy(() => import("./pages/PricingPage"));
const Home                   = lazy(() => import("./pages/Home"));
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
const ProcessedImages        = lazy(() => import("./pages/ProcessedImages"));

const queryClient = new QueryClient();

function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <QueryClientProvider client={queryClient}>
          <BrowserRouter>
            <Routes>
              <Route element={<PublicLayout />}>
                <Route path="/" element={<LandingPage />} />
                <Route path="/pricing" element={<PricingPage />} />
                <Route path="/signin" element={<PublicOnlyRoute><SignIn /></PublicOnlyRoute>} />
                <Route path="/signup" element={<PublicOnlyRoute><SignUp /></PublicOnlyRoute>} />
              </Route>

              <Route element={<AppLayout />}>
                <Route path="/dashboard"          element={<Home />} />
                <Route path="/transactions"       element={<ExpenseList />} />
                <Route path="/upload"             element={<UploadReceipt />} />
                <Route path="/entry"              element={<TransactionEntry />} />
                <Route path="/review"             element={<ReviewQueue />} />
                <Route path="/review/:transactionId/items/:itemId" element={<ReviewItemEdit />} />
                <Route path="/review/:transactionId/edit"          element={<ReviewTransactionEdit />} />
                <Route path="/groups"             element={<GroupManager />} />
                <Route path="/analytics"          element={<Analytics />} />
                <Route path="/product-audit"      element={<ProductAudit />} />
                <Route path="/vendor-audit"       element={<VendorAudit />} />
                <Route path="/invitations"        element={<Invitations />} />
                <Route path="/recurring"          element={<RecurringExpenses />} />
                <Route path="/recurring/new"      element={<AddRecurringExpense />} />
                <Route path="/recurring/:id/edit" element={<EditRecurringExpense />} />
                <Route path="/shopping-list"      element={<ShoppingList />} />
                <Route path="/processed-images"   element={<ProcessedImages />} />
                <Route path="/profile"            element={<Profile />} />
              </Route>

              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </BrowserRouter>
        </QueryClientProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}

export default App;
