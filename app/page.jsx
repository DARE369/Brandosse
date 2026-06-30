import NextPublicProviders from "@/next/NextPublicProviders";
import LandingPage from "@/pages/Landing/LandingPage";

export default function HomePage() {
  return (
    <NextPublicProviders>
      <LandingPage />
    </NextPublicProviders>
  );
}