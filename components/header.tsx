// header for both the pages
export function Header() {
  return (
    <header className="flex items-center justify-between border-b border-slate-200 bg-slate-100 px-6 py-4">
      <span className="text-base font-bold text-slate-900">Candidate Interview</span>
      <nav className="flex items-center gap-2 text-sm text-slate-900">
        <button type="button" className="hover:underline">
          Log out
        </button>
      </nav>
    </header>
  );
}