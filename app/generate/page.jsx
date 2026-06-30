import { redirect } from "next/navigation";

export default function LegacyGenerateRedirectPage() {
  redirect("/app/generate");
}
