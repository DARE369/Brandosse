import CommonRoom from "@/org/pages/CommonRoom";

export const metadata = { title: "Common Room Channel | Brandosse" };

export default async function OrgCommonRoomChannelPage({ params }) {
  const { channelId } = await params;
  return <CommonRoom channelId={channelId} />;
}