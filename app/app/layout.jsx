import NextAppProviders from "@/next/NextAppProviders";

export default function AppLayout({ children }) {
  return <NextAppProviders>{children}</NextAppProviders>;
}
