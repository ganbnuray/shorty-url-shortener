import { useParams, useNavigate } from "react-router-dom";
import { useEffect } from "react";
import { Loader2 } from "lucide-react";

function RedirectPage() {
  const { slug } = useParams();
  const navigate = useNavigate();

  useEffect(() => {
    const redirect = async () => {
      try {
        const res = await fetch(`http://localhost:3000/${slug}`, {
          headers: {
            Accept: "application/json",
            "X-Requested-With": "XMLHttpRequest",
          },
        });

        if (res.status === 404) return navigate("/not-found");
        if (res.status === 410) return navigate("/expired");

        if (res.status === 200) {
          const data = await res.json();
          if (data.original_url) {
            window.location.href = data.original_url;
          } else {
            navigate("/not-found");
          }
          return;
        }

        // Any other status code
        navigate("/not-found");
      } catch (err) {
        console.error("Redirection failed", err);
        navigate("/not-found");
      }
    };

    if (slug) redirect();
  }, [slug, navigate]);

  return (
    <div className="flex items-center justify-center min-h-screen bg-white">
      <div className="flex flex-col items-center space-y-4">
        <Loader2 className="animate-spin w-8 h-8 text-gray-500" />
        <p className="text-gray-700 text-lg font-medium">Redirecting...</p>
      </div>
    </div>
  );
}

export default RedirectPage;
