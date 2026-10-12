import { redirect } from "next/navigation";

// Older emails link here; the pay page itself is plain HTML at /p/[token]
// so the same page can also be served on customer domains.
export default async function HostingInvoicePayPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  redirect(`/p/${encodeURIComponent(token)}`);
}
