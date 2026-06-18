import { Link, Navigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuth } from "../lib/auth";
import {
  ScanLine,
  BarChart2,
  Users,
  Repeat,
  ShoppingCart,
  ShieldCheck,
  ArrowRight,
} from "lucide-react";

const features = [
  { icon: ScanLine,    key: "receiptScan"   },
  { icon: BarChart2,   key: "analytics"     },
  { icon: Users,       key: "groups"        },
  { icon: Repeat,      key: "recurring"     },
  { icon: ShoppingCart,key: "shoppingList"  },
  { icon: ShieldCheck, key: "normalization" },
];

export function LandingPage() {
  const { user, loading } = useAuth();
  const { t } = useTranslation();

  if (!loading && user) {
    return <Navigate to="/dashboard" replace />;
  }

  return (
    <div className="landing">
      <section className="landing__hero">
        <p className="eyebrow">{t("landing.eyebrow")}</p>
        <h1 className="landing__headline">{t("landing.headline")}</h1>
        <p className="landing__sub">{t("landing.sub")}</p>
        <div className="landing__hero-actions">
          <Link to="/signup" className="button landing__cta-btn">
            {t("landing.getStarted")}
            <ArrowRight size={16} />
          </Link>
          <Link to="/signin" className="button button--secondary">
            {t("auth.signIn")}
          </Link>
        </div>
      </section>

      <section className="landing__features">
        <h2 className="landing__section-title">{t("landing.featuresTitle")}</h2>
        <div className="landing__features-grid">
          {features.map(({ icon: Icon, key }) => (
            <div key={key} className="landing__feature-card">
              <div className="landing__feature-icon">
                <Icon size={22} />
              </div>
              <h3>{t(`landing.features.${key}.title`)}</h3>
              <p>{t(`landing.features.${key}.desc`)}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="landing__bottom-cta">
        <h2>{t("landing.bottomCtaTitle")}</h2>
        <p>{t("landing.bottomCtaSub")}</p>
        <Link to="/signup" className="button landing__cta-btn">
          {t("landing.getStarted")}
          <ArrowRight size={16} />
        </Link>
      </section>
    </div>
  );
}

export default LandingPage;
