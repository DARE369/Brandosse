import NextPublicProviders from "@/next/NextPublicProviders";
import InvitationAcceptPage from "@/pages/InvitationAccept/InvitationAcceptPage";

export const metadata = { title: "Join Workspace | Brandosse" };

export default function JoinPage() {
  return (
    <NextPublicProviders>
      <InvitationAcceptPage />
    </NextPublicProviders>
  );
}