import { ContactChat } from "../../../components/ContactChat.tsx";
import { WorkspaceShell } from "../../../components/WorkspaceShell.tsx";

interface ContactPageProps {
  params: Promise<{ contactId: string }>;
}

export default async function ContactPage({ params }: ContactPageProps) {
  const { contactId } = await params;
  return (
    <WorkspaceShell activeContactId={contactId}>
      <ContactChat contactId={contactId} />
    </WorkspaceShell>
  );
}
