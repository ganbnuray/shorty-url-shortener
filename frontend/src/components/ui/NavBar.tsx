export default function NavBar() {
  return (
    <nav className="w-full bg-white shadow-md px-6 py-4 flex items-center justify-between">
      <div className="flex items-center space-x-3">
        <img src="/logo.svg" alt="Shorty Logo" className="h-6 w-6" />
        <span className="text-xl font-bold text-gray-800 tracking-tight">
          Shorty
        </span>
      </div>

      {/* Future nav items here */}
    </nav>
  );
}
