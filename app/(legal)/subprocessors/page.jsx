import SubprocessorsPage from "@/pages/Legal/SubprocessorsPage";
import { legalMetadata } from "@/pages/Legal/legalMetadata";

export const metadata = legalMetadata("subprocessors");

export const dynamic = "force-static";

export default function SubprocessorsRoute() {
  return <SubprocessorsPage />;
}
