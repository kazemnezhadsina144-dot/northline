import Link from "next/link";

export function SiteHeader() {
  return (
    <header className="top">
      <Link className="brand" href="/">Northline</Link>
      <nav>
        <Link href="/history">History</Link>
        <Link href="/risks">Risks</Link>
      </nav>
    </header>
  );
}
