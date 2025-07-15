export default function NavBar() {
  return (
    <nav className="w-full bg-white shadow-md">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          <div className="flex items-center space-x-3">
            <img
              src="/logo.svg"
              alt="Shorty Logo"
              className="h-6 w-6 sm:h-8 sm:w-8"
            />
            <span className="text-xl sm:text-2xl font-bold text-gray-800 tracking-tight">
              Shorty
            </span>
          </div>
          {/* Future nav items here */}
        </div>
      </div>
    </nav>
  );
}
