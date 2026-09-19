import GeneratePageV2 from "@/pages/GeneratePage/GeneratePageV2";

export const metadata = {
  title: "Generate Session | Brandosse",
};

export default async function GenerateSessionPage({ params }) {
  const { sessionId } = await params;
  return <GeneratePageV2 sessionId={sessionId} />;
}