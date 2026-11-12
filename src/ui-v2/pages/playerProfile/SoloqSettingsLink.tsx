import { useInRouterContext, useLocation, useNavigate } from "react-router-dom";

interface SoloqSettingsLinkProps {
  label: string;
  className?: string;
}

function RouterSettingsLink({ label, className }: SoloqSettingsLinkProps) {
  const navigate = useNavigate();
  const location = useLocation();
  return (
    <button
      type="button"
      className={className}
      onClick={() => navigate("/settings", { state: { from: `${location.pathname}${location.search}` } })}
    >
      {label}
    </button>
  );
}

/** Opens Settings (where the decay mode is changed). Outside a router it is a plain anchor. */
export default function SoloqSettingsLink(props: SoloqSettingsLinkProps) {
  const inRouter = useInRouterContext();
  if (inRouter) return <RouterSettingsLink {...props} />;
  return (
    <a href="/settings" className={props.className}>
      {props.label}
    </a>
  );
}
