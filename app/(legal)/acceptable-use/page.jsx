import AcceptableUsePolicy from "@/pages/Legal/AcceptableUsePolicy";
import { legalMetadata } from "@/pages/Legal/legalMetadata";

export const metadata = legalMetadata("acceptable-use");

export const dynamic = "force-static";

export default function AcceptableUsePage() {
  return <AcceptableUsePolicy />;
}
