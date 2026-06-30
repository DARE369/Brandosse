import NextPublicProviders from "@/next/NextPublicProviders";
import NotFoundPage from "@/pages/NotFoundPage";

export default function CatchAllPage() {
  return (
    <NextPublicProviders>
      <NotFoundPage />
    </NextPublicProviders>
  );
}