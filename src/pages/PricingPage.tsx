import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Check } from "lucide-react";

export function PricingPage() {
  const { t } = useTranslation();

  const freeFeatures: string[] = t("pricing.freeFeatures", { returnObjects: true }) as string[];

  return (
    <div className="pricing">
      <section className="pricing__hero">
        <p className="eyebrow">{t("pricing.eyebrow")}</p>
        <h1>{t("pricing.headline")}</h1>
        <p className="landing__sub">{t("pricing.sub")}</p>
      </section>

      <div className="pricing__cards">
        <div className="pricing__card pricing__card--free">
          <div className="pricing__plan-name">{t("pricing.free.name")}</div>
          <div className="pricing__price">
            <span className="pricing__amount">{t("pricing.free.price")}</span>
          </div>
          <p className="pricing__plan-desc">{t("pricing.free.desc")}</p>
          <ul className="pricing__features">
            {freeFeatures.map((feature, i) => (
              <li key={i}>
                <Check size={14} color="var(--color-success)" />
                {feature}
              </li>
            ))}
          </ul>
          <Link to="/signup" className="button">{t("pricing.free.cta")}</Link>
        </div>
      </div>
    </div>
  );
}

export default PricingPage;
