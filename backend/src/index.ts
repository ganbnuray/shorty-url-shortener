import express, { Request, Response } from "express";
import cors from "cors";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { add } from "date-fns";

const dateFnsTz = require("date-fns-tz");
const { zonedTimeToUtc } = dateFnsTz;
import cron from "node-cron";

declare global {
  namespace Express {
    interface Request {
      userTimezone?: string;
    }
  }
}

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

app.use((req: Request, res: Response, next: any) => {
  // Get timezone from request headers (automatically sent by browsers)
  const timezoneHeader = req.headers["x-timezone"] || req.headers["timezone"];
  const timezone = Array.isArray(timezoneHeader)
    ? timezoneHeader[0]
    : timezoneHeader;

  // Store timezone info in request object
  req.userTimezone = timezone;
  next();
});

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

function convertLocalToUTC(localTimeString: string, timezone?: string): Date {
  if (!timezone) {
    return new Date(localTimeString);
  }

  try {
    return zonedTimeToUtc(localTimeString, timezone);
  } catch (error) {
    console.error("Timezone conversion error:", error);
    return new Date(localTimeString);
  }
}

app.get("/ping", (req: Request, res: Response) => {
  res.send("pong");
});

app.post("/shorten", async (req: Request, res: Response): Promise<any> => {
  let { original_url, expires_at, relative_expiry, timezone } = req.body;

  if (!original_url) {
    return res.status(400).json({ error: "Missing original_url" });
  }

  if (
    !original_url.startsWith("http://") &&
    !original_url.startsWith("https://")
  ) {
    original_url = "https://" + original_url;
  }

  if (!isValidUrl(original_url)) {
    return res.status(400).json({ error: "Invalid URL format" });
  }

  // Determine which timezone to use
  const effectiveTimezone = timezone || req.userTimezone;
  let expiration: Date | null = null;

  if (expires_at) {
    expiration = convertLocalToUTC(expires_at, effectiveTimezone);

    console.log(
      `📍 Using timezone: ${effectiveTimezone || "Server local time"}`
    );
    console.log(`📅 Input expires_at: ${expires_at}`);
    console.log(`🕒 UTC equivalent: ${expiration.toISOString()}`);
    console.log(`🕒 Now (UTC): ${new Date().toISOString()}`);

    if (isNaN(expiration.getTime())) {
      return res.status(400).json({ error: "Invalid expires_at format" });
    }
  } else if (relative_expiry) {
    const now = new Date();
    const { count, unit } = relative_expiry;

    if (
      !["days", "months", "years", "minutes", "hours"].includes(unit) ||
      isNaN(count)
    ) {
      return res.status(400).json({ error: "Invalid relative_expiry format" });
    }

    expiration = add(now, { [unit]: count });
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
    expires_at_utc: expiration?.toISOString(),
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

  // Check for expiration using UTC time
  const now = new Date();
  if (data.expires_at && new Date(data.expires_at) < now) {
    console.log(
      `🚫 URL ${slug} expired at ${
        data.expires_at
      }, current time: ${now.toISOString()}`
    );
    return res.status(410).json({ error: "This link has expired." });
  }

  // Increment click count
  const { error: updateError } = await supabase
    .from("urls")
    .update({ clicks: (data.clicks || 0) + 1 })
    .eq("short_code", slug);

  if (updateError) {
    console.error("Failed to update click count:", updateError.message);
  }

  res.redirect(data.original_url);
});

// Start server
app.listen(PORT, () => {
  console.log(`✅ Backend server is running at http://localhost:${PORT}`);
});

cron.schedule("*/2 * * * *", async () => {
  const now = new Date().toISOString();
  console.log(`🔍 Checking for expired URLs at ${now}`);

  const { data, error } = await supabase
    .from("urls")
    .delete()
    .lt("expires_at", now)
    .select("*");

  if (error) {
    console.error("❌ Error deleting expired URLs:", error.message);
  } else {
    console.log(`✅ Deleted ${data?.length || 0} expired URLs.`);
  }
});
