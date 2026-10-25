import { Suspense } from "react";
import WorkflowView from "../../ticket-executor/workflow/WorkflowView";

export default function WorkflowPage() {
  return (
    <Suspense>
      <WorkflowView />
    </Suspense>
  );
}
