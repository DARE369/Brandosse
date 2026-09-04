import LegalIndex from "@/pages/Legal/LegalIndex";
import { legalHubMetadata } from "@/pages/Legal/legalMetadata";

export const metadata = legalHubMetadata();

export const dynamic = "force-static";

export default function LegalIndexPage() {
  return <LegalIndex />;
}
