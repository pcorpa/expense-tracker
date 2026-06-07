import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  Home as HomeIcon,
  Plus,
  Users,
  ClipboardList,
  CheckCircle2,
  User as UserIcon,
  LogOut,
  Menu,
  X,
  Image,
  BarChart2,
  ShieldCheck,
  Mail,
  Store,
} from "lucide-react";
import { usePendingAuditCount } from "../lib/usePendingAuditCount";
import { usePendingInvitationsCount } from "../lib/usePendingInvitationsCount";
import { usePendingVendorCount } from "../lib/usePendingVendorCount";

const links = [
  { to: "/", label: "Home", icon: HomeIcon },
  { to: "/entry", label: "New Entry", icon: Plus },
  { to: "/upload", label: "Upload Receipt", icon: Image },
  { to: "/transactions", label: "Transactions", icon: ClipboardList },
  { to: "/review", label: "Review", icon: CheckCircle2 },
  { to: "/analytics", label: "Analytics", icon: BarChart2 },
  { to: "/product-audit", label: "Product Audit", icon: ShieldCheck, badge: "audit" },
  { to: "/vendor-audit", label: "Vendor Audit", icon: Store, badge: "vendor" },
  { to: "/invitations", label: "Invitations", icon: Mail, badge: "invitations" },
  { to: "/groups", label: "Groups", icon: Users },
  { to: "/profile", label: "Profile", icon: UserIcon },
];

export function MobileMenu({
  user,
  signOut,
}: {
  user: any;
  signOut: () => void;
}) {
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const { data: pendingCount = 0 } = usePendingAuditCount();
  const { data: invitationsCount = 0 } = usePendingInvitationsCount();
  const { data: vendorCount = 0 } = usePendingVendorCount();

  const avatarUrl = user?.user_metadata?.avatar_url;
  const displayName =
    user?.user_metadata?.full_name ||
    user?.user_metadata?.name ||
    user?.email;

  return (
    <div className="mobile-nav">
      {/* Header Compacto con Foto y Email */}
      <div className="mobile-nav__bar">
        <div className="mobile-nav__identity">
          {avatarUrl ? (
            <img src={avatarUrl} alt="Profile" className="avatar-img" />
          ) : (
            <span className="logo">E</span>
          )}
          <span className="mobile-nav__email">{displayName}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {invitationsCount > 0 && (
            <span style={{
              background: "#3b82f6",
              color: "#fff",
              borderRadius: 10,
              padding: "2px 8px",
              fontSize: "0.72rem",
              fontWeight: 700,
            }}>
              {invitationsCount > 99 ? "99+" : invitationsCount} invite{invitationsCount > 1 ? "s" : ""}
            </span>
          )}
          {pendingCount > 0 && (
            <span style={{
              background: "#f59e0b",
              color: "#000",
              borderRadius: 10,
              padding: "2px 8px",
              fontSize: "0.72rem",
              fontWeight: 700,
            }}>
              {pendingCount > 99 ? "99+" : pendingCount} audit
            </span>
          )}
          {vendorCount > 0 && (
            <span style={{
              background: "#f59e0b",
              color: "#000",
              borderRadius: 10,
              padding: "2px 8px",
              fontSize: "0.72rem",
              fontWeight: 700,
            }}>
              {vendorCount > 99 ? "99+" : vendorCount} vendor
            </span>
          )}
          <button className="mobile-nav__burger" onClick={() => setOpen(true)}>
            <Menu size={28} />
          </button>
        </div>
      </div>

      {open && (
        <>
          <div className="mobile-nav__overlay" onClick={() => setOpen(false)} />
          <nav className="mobile-nav__drawer">
            <div className="mobile-nav__drawer-header">
              <button onClick={() => setOpen(false)}>
                <X size={28} />
              </button>
            </div>

            <div className="mobile-nav__links">
              {links.map((item) => {
                const Icon = item.icon;
                const active = location.pathname === item.to;
                const count = item.badge === "audit" ? pendingCount : item.badge === "invitations" ? invitationsCount : item.badge === "vendor" ? vendorCount : 0;
                return (
                  <Link
                    key={item.to}
                    to={item.to}
                    className={active ? "active" : ""}
                    onClick={() => setOpen(false)}
                    style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}
                  >
                    <span style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      <Icon size={24} /> <span>{item.label}</span>
                    </span>
                    {count > 0 && (
                      <span style={{
                        background: "#f59e0b",
                        color: "#000",
                        borderRadius: 10,
                        padding: "1px 8px",
                        fontSize: "0.72rem",
                        fontWeight: 700,
                      }}>
                        {count > 99 ? "99+" : count}
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>

            <div className="mobile-nav__footer">
              <button className="mobile-nav__logout" onClick={signOut}>
                <LogOut size={24} /> <span>Sign out</span>
              </button>
            </div>
          </nav>
        </>
      )}
    </div>
  );
}
