import NextPublicProviders from "@/next/NextPublicProviders";
import CompleteSignup from "@/pages/Auth/CompleteSignupPage";

export const metadata = { title: "Complete Signup | Brandosse" };

export default function CompleteSignupPage() {
  return (
    <NextPublicProviders>
      <CompleteSignup />
    </NextPublicProviders>
  );
}