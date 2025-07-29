function ExpiredPage() {
  return (
    <div className="flex items-center justify-center min-h-screen bg-white">
      <div className="text-center space-y-2">
        <h1 className="text-3xl font-semibold text-gray-800">410 - Expired</h1>
        <p className="text-gray-600">This short link has expired.</p>
        <a href="/" className="text-blue-600 underline">
          Create a new one
        </a>
      </div>
    </div>
  );
}

export default ExpiredPage;
