import NextPublicProviders from "@/next/NextPublicProviders";
import AuthCallback from "@/pages/Auth/AuthCallback";

export const metadata = { title: "Auth Callback | Brandosse" };

export default function AuthCallbackPage() {
  return (
    <NextPublicProviders>
      <AuthCallback />
    </NextPublicProviders>
  );
}