import express, { Request, Response } from "express";
import cors from "cors";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { add } from "date-fns";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Supabase client
const supabase = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function isValidUrl(url: string): boolean {
  try {
    // This will throw if url is invalid
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

function generateSlug(length = 7): string {
  const chars =
    "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let slug = "";
  for (let i = 0; i < length; i++) {
    slug += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return slug;
}

// Test route
app.get("/ping", (req: Request, res: Response) => {
  res.send("pong");
});

// URL shortening route
app.post("/shorten", async (req: Request, res: Response): Promise<any> => {
  let { original_url, expires_at, relative_expiry } = req.body;

  if (!original_url) {
    return res.status(400).json({ error: "Missing original_url" });
  }

  if (
    !original_url.startsWith("http://") &&
    !original_url.startsWith("https://")
  ) {
    original_url = "http://" + original_url;
  }

  if (!isValidUrl(original_url)) {
    return res.status(400).json({ error: "Invalid URL format" });
  }

  // Generate expiration date
  let expiration: Date | null = null;

  if (expires_at) {
    expiration = new Date(expires_at);
    if (isNaN(expiration.getTime())) {
      return res.status(400).json({ error: "Invalid expires_at format" });
    }
  } else if (relative_expiry) {
    const now = new Date();
    const { count, unit } = relative_expiry;
    if (!["days", "months", "years"].includes(unit) || isNaN(count)) {
      return res.status(400).json({ error: "Invalid relative_expiry format" });
    }
    expiration = add(now, { [unit]: count }); // using date-fns
  }

  const short_code = generateSlug();

  const { data, error } = await supabase
    .from("urls")
    .insert([{ original_url, short_code, expires_at: expiration }])
    .select()
    .single();

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  return res.status(201).json({
    short_url: `http://localhost:3000/${data.short_code}`,
    expires_at: expiration,
  });
});

app.get("/:slug", async (req, res): Promise<any> => {
  const { slug } = req.params;

  const { data, error } = await supabase
    .from("urls")
    .select("original_url, clicks, expires_at")
    .eq("short_code", slug)
    .single();

  if (error || !data) return res.status(404).json({ error: "Not found" });

  // Check for expiration
  const now = new Date();
  if (data.expires_at && new Date(data.expires_at) < now) {
    return res.status(410).json({ error: "This link has expired." });
  }

  // Increment click count
  await supabase
    .from("urls")
    .update({ clicks: data.clicks + 1 })
    .eq("short_code", slug);

  res.redirect(data.original_url);
});

// Start server
app.listen(PORT, () => {
  console.log(`✅ Backend server is running at http://localhost:${PORT}`);
});
