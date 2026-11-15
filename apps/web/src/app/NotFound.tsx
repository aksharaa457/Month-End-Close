import { Link } from "react-router-dom";
import { Button } from "@/shared/ui/button";
import { EmptyState } from "@/shared/ui/misc";

export function NotFound() {
  return (
    <EmptyState
      title="Page not found"
      description="The page you're looking for doesn't exist or you don't have access to it."
      action={
        <Button asChild size="sm">
          <Link to="/hub">Go to close status</Link>
        </Button>
      }
    />
  );
}
