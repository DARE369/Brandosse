import NextPublicProviders from "@/next/NextPublicProviders";
import ClientReviewPage from "@/pages/ClientReview/ClientReviewPage";

export const metadata = { title: "Content Review | Brandosse" };

export default async function ClientReviewRoute({ params }) {
  const { clientReviewToken } = await params;
  return (
    <NextPublicProviders>
      <ClientReviewPage clientReviewToken={clientReviewToken} />
    </NextPublicProviders>
  );
}