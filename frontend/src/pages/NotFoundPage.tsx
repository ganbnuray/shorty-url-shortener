function NotFoundPage() {
  return (
    <div className="flex items-center justify-center min-h-screen bg-white">
      <div className="text-center space-y-2">
        <h1 className="text-3xl font-semibold text-gray-800">
          404 - Not Found
        </h1>
        <p className="text-gray-600">We couldn’t find that short link.</p>
        <a href="/" className="text-blue-600 underline">
          Go back home
        </a>
      </div>
    </div>
  );
}

export default NotFoundPage;
