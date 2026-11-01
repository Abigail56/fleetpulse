import { ButtonLink } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col items-start justify-center gap-4 px-4 py-20">
      <p className="font-mono text-sm opacity-70">404</p>
      <h1 className="text-4xl font-bold tracking-tight">Page not found</h1>
      <p className="opacity-85">This page doesn&apos;t exist or has moved.</p>
      <ButtonLink href="/">Back to home</ButtonLink>
    </main>
  );
}
