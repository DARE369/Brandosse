import TermsOfService from "@/pages/Legal/TermsOfService";
import { legalMetadata } from "@/pages/Legal/legalMetadata";

export const metadata = legalMetadata("terms");

// Nothing on this page depends on the request, so it is prerendered at build
// time and served as static HTML. That is the point: a platform reviewer or a
// crawler gets the document on first byte, with no session lookup in the way.
export const dynamic = "force-static";

export default function TermsPage() {
  return <TermsOfService />;
}
