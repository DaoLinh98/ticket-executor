import { redirect } from "next/navigation";

// The app opens on Ticket Execution, not on the landing page: this is a tool
// its owner reaches for with a ticket in mind, and on a phone the extra hop
// cost a tap every single time. The landing page still exists at `/home`,
// which is where the Sidebar's Home item points.
export default function RootPage() {
  redirect("/ticket-execution");
}
