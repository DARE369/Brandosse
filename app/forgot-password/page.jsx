import NextPublicProviders from "@/next/NextPublicProviders";
import ForgotPassword from "@/pages/Auth/ForgotPassword";

export const metadata = { title: "Forgot Password | Brandosse" };

export default function ForgotPasswordPage() {
  return (
    <NextPublicProviders>
      <ForgotPassword />
    </NextPublicProviders>
  );
}