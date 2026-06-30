import VideoJobDetailPage from "@/pages/VideoEngine/VideoJobDetailPage";

export const metadata = {
  title: "Video Job | Brandosse Command Center",
};

export default async function VideoJobDetailRoute({ params }) {
  const { id } = await params;
  return <VideoJobDetailPage jobId={id} />;
}