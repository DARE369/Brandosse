import NextPublicProviders from "@/next/NextPublicProviders";
import Login from "@/pages/Auth/Login";

export const metadata = { title: "Login | Brandosse" };

export default function LoginPage() {
  return (
    <NextPublicProviders>
      <Login />
    </NextPublicProviders>
  );
}