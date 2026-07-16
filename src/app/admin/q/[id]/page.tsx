import Editor from "./Editor";

export default async function QuestionnaireEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Editor questionnaireId={id} />;
}
