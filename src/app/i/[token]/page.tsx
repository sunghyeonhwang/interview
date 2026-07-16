import RespondentForm from "./RespondentForm";

export default async function InterviewPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <RespondentForm token={token} />;
}
