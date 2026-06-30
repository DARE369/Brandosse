import NextPublicProviders from "@/next/NextPublicProviders";
import ResetPassword from "@/pages/Auth/ResetPassword";

export const metadata = { title: "Reset Password | Brandosse" };

export default function ResetPasswordPage() {
  return (
    <NextPublicProviders>
      <ResetPassword />
    </NextPublicProviders>
  );
}