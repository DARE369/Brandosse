import NextPublicProviders from "@/next/NextPublicProviders";
import ContextSelectorPage from "@/pages/ContextSelector/ContextSelectorPage";

export const metadata = { title: "Select Workspace | Brandosse" };

export default function SelectContextPage() {
  return (
    <NextPublicProviders>
      <ContextSelectorPage />
    </NextPublicProviders>
  );
}