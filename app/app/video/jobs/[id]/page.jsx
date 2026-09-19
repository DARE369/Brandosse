import VideoJobPage from "@/pages/VideoEngine/VideoJobPage";

export const metadata = {
  title: "Video job | Brandosse",
};

export default async function VideoJobDetailRoute({ params }) {
  const { id } = await params;
  return <VideoJobPage jobId={id} />;
}
