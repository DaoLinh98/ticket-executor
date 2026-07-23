import { Suspense } from "react";
import TicketExecutor from "../../TicketExecutor";

// TicketExecutor reads the `?project=` query param via useSearchParams, which
// requires a Suspense boundary under the App Router.
export default function TicketExecutionPage() {
  return (
    <Suspense fallback={null}>
      <TicketExecutor />
    </Suspense>
  );
}
