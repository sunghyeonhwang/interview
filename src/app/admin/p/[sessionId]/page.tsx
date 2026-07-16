import Pipeline from "./Pipeline";

export default async function PipelinePage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  return <Pipeline sessionId={sessionId} />;
}
