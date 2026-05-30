import { Link, useLocation } from "react-router-dom";
import { useAuth } from "../lib/auth";
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
} from "lucide-react";

const links = [
  { to: "/", label: "Home", icon: HomeIcon },
  { to: "/entry", label: "New Entry", icon: Upload },
  { to: "/upload", label: "Upload Receipt", icon: Image },
  { to: "/transactions", label: "Transactions", icon: ClipboardList },
  { to: "/review", label: "Review", icon: CheckCircle2 },
  { to: "/analytics", label: "Analytics", icon: BarChart2 },
  { to: "/groups", label: "Groups", icon: Users },
  { to: "/profile", label: "Profile", icon: User },
];

export function NavBar() {
  const { user, signOut } = useAuth();
  const location = useLocation();

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
          return (
            <Link key={item.to} to={item.to} className={active ? "active" : ""}>
              <Icon size={18} />
              {item.label}
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
