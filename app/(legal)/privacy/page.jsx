import PrivacyPolicy from "@/pages/Legal/PrivacyPolicy";
import { legalMetadata } from "@/pages/Legal/legalMetadata";

export const metadata = legalMetadata("privacy");

export const dynamic = "force-static";

export default function PrivacyPage() {
  return <PrivacyPolicy />;
}
