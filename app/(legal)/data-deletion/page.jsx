import DataDeletion from "@/pages/Legal/DataDeletion";
import { legalMetadata } from "@/pages/Legal/legalMetadata";

// This is the URL that goes in Meta App Review's "Data Deletion Instructions
// URL" field, and the equivalent field on TikTok and LinkedIn. It must resolve
// publicly, with no sign-in, on first byte.
export const metadata = legalMetadata("data-deletion");

export const dynamic = "force-static";

export default function DataDeletionPage() {
  return <DataDeletion />;
}
