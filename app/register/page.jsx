import NextPublicProviders from "@/next/NextPublicProviders";
import Register from "@/pages/Auth/Register";

export const metadata = { title: "Register | Brandosse" };

export default function RegisterPage() {
  return (
    <NextPublicProviders>
      <Register />
    </NextPublicProviders>
  );
}