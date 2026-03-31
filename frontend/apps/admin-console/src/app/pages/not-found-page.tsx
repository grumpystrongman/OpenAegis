import { Link } from "react-router-dom";
import { EmptyState, Panel } from "../ui.js";

export const NotFoundPage = () => (
  <Panel title="Page not found" subtitle="The requested route does not exist in this workspace.">
    <EmptyState
      title="Unknown route"
      description="Use Setup Center to restart guided onboarding and navigation."
      action={
        <Link className="subtle-link" to="/setup">
          Return to Setup Center
        </Link>
      }
    />
  </Panel>
);
