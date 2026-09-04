import RefundPolicy from "@/pages/Legal/RefundPolicy";
import { legalMetadata } from "@/pages/Legal/legalMetadata";

export const metadata = legalMetadata("refunds");

export const dynamic = "force-static";

export default function RefundsPage() {
  return <RefundPolicy />;
}
