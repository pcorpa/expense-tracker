import { Link, useLocation } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { usePendingAuditCount } from "../lib/usePendingAuditCount";
import { usePendingInvitationsCount } from "../lib/usePendingInvitationsCount";
import { usePendingVendorCount } from "../lib/usePendingVendorCount";
import {
  LogOut,
  Home as HomeIcon,
  Upload,
  Users,
  ClipboardList,
  CheckCircle2,
  User,
  Image,
  BarChart2,
  ShieldCheck,
  Mail,
  Store,
  Repeat,
} from "lucide-react";

const links = [
  { to: "/", label: "Home", icon: HomeIcon },
  { to: "/entry", label: "New Entry", icon: Upload },
  { to: "/upload", label: "Upload Receipt", icon: Image },
  { to: "/transactions", label: "Transactions", icon: ClipboardList },
  { to: "/review", label: "Review", icon: CheckCircle2 },
  { to: "/recurring", label: "Recurrentes", icon: Repeat },
  { to: "/analytics", label: "Analytics", icon: BarChart2 },
  { to: "/product-audit", label: "Product Audit", icon: ShieldCheck, badge: "audit" },
  { to: "/vendor-audit", label: "Vendor Audit", icon: Store, badge: "vendor" },
  { to: "/invitations", label: "Invitations", icon: Mail, badge: "invitations" },
  { to: "/groups", label: "Groups", icon: Users },
  { to: "/profile", label: "Profile", icon: User },
];

export function NavBar() {
  const { user, signOut } = useAuth();
  const location = useLocation();
  const { data: pendingCount = 0 } = usePendingAuditCount();
  const { data: invitationsCount = 0 } = usePendingInvitationsCount();
  const { data: vendorCount = 0 } = usePendingVendorCount();

  return (
    <header className="app-shell__nav">
      <div className="app-shell__brand">
        <div className="logo">E</div>
        <div>
          <p>Expense Tracker</p>
          <span>Modern, mobile-first expense tracking</span>
        </div>
      </div>

      <nav className="app-shell__links">
        {links.map((item) => {
          const Icon = item.icon;
          const active = location.pathname === item.to;
          const count = item.badge === "audit" ? pendingCount : item.badge === "invitations" ? invitationsCount : item.badge === "vendor" ? vendorCount : 0;
          return (
            <Link key={item.to} to={item.to} className={active ? "active" : ""} style={{ position: "relative" }}>
              <Icon size={18} />
              {item.label}
              {count > 0 && (
                <span style={{
                  marginLeft: "auto",
                  background: "#f59e0b",
                  color: "#000",
                  borderRadius: 10,
                  padding: "1px 7px",
                  fontSize: "0.7rem",
                  fontWeight: 700,
                  lineHeight: "1.4",
                  minWidth: 18,
                  textAlign: "center",
                }}>
                  {count > 99 ? "99+" : count}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      <div className="app-shell__actions">
        <span>{user?.email ?? "Invitado"}</span>
        <button type="button" onClick={signOut} className="secondary">
          <LogOut size={16} /> Sign out
        </button>
      </div>
    </header>
  );
}
