import type { ReactNode } from "react";

export type Tone = "default" | "success" | "warning" | "danger" | "info";

export const classNames = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(" ");

export const toneClass = (tone: Tone) =>
  ({
    default: "tone-default",
    success: "tone-success",
    warning: "tone-warning",
    danger: "tone-danger",
    info: "tone-info"
  })[tone];

export const PageHeader = ({
  eyebrow,
  title,
  subtitle,
  actions
}: {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) => (
  <header className="page-header">
    <div>
      {eyebrow ? <div className="eyebrow">{eyebrow}</div> : null}
      <h2>{title}</h2>
      {subtitle ? <p className="page-subtitle">{subtitle}</p> : null}
    </div>
    {actions ? <div className="page-actions">{actions}</div> : null}
  </header>
);

export const Panel = ({
  title,
  subtitle,
  actions,
  children,
  tone = "default"
}: {
  title?: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
  tone?: Tone;
}) => (
  <section className={classNames("panel", toneClass(tone))}>
    {title || subtitle || actions ? (
      <div className="panel-head">
        <div>
          {title ? <h3>{title}</h3> : null}
          {subtitle ? <p className="panel-subtitle">{subtitle}</p> : null}
        </div>
        {actions ? <div className="panel-actions">{actions}</div> : null}
      </div>
    ) : null}
    {children}
  </section>
);

export const MetricTile = ({
  label,
  value,
  detail,
  tone = "default"
}: {
  label: string;
  value: ReactNode;
  detail?: ReactNode;
  tone?: Tone;
}) => (
  <article className={classNames("metric-tile", toneClass(tone))}>
    <div className="metric-label">{label}</div>
    <div className="metric-value">{value}</div>
    {detail ? <div className="metric-detail">{detail}</div> : null}
  </article>
);

export const Badge = ({ children, tone = "default" }: { children: ReactNode; tone?: Tone }) => (
  <span className={classNames("badge", toneClass(tone))}>{children}</span>
);

export const KeyValueList = ({
  items
}: {
  items: Array<{ label: string; value: ReactNode; tone?: Tone }>;
}) => (
  <dl className="key-value-list">
    {items.map((item) => (
      <div key={item.label} className="key-value-item">
        <dt>{item.label}</dt>
        <dd>{item.value}</dd>
      </div>
    ))}
  </dl>
);

export const EmptyState = ({
  title,
  description,
  action
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) => (
  <div className="empty-state">
    <strong>{title}</strong>
    <p>{description}</p>
    {action ? <div className="empty-action">{action}</div> : null}
  </div>
);

export const JsonBlock = ({ value }: { value: unknown }) => (
  <pre className="json-block">{JSON.stringify(value, null, 2)}</pre>
);

export const Table = ({ children }: { children: ReactNode }) => <table className="table">{children}</table>;
