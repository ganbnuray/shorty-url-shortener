import express, { Request, Response } from "express";
import cors from "cors";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { add } from "date-fns";
import cron from "node-cron";
import validator from "validator";
const isURL = validator.isURL;
import { nanoid } from "nanoid";
import { createClient as createRedisClient } from "redis";
import QRCode from "qrcode";
dotenv.config();

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
app.use(
  cors({
    origin: [
      "https://shorty-linky.vercel.app", // Production
      "http://localhost:3000",
      "http://localhost:5173", // Vite default
    ],
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

app.use(express.json());

// Timezone middleware
app.use((req: Request, res: Response, next: any) => {
  const timezoneHeader = req.headers["x-timezone"] || req.headers["timezone"];
  const timezone = Array.isArray(timezoneHeader)
    ? timezoneHeader[0]
    : timezoneHeader;

  req.userTimezone = timezone || undefined;
  next();
});

const redisClient = createRedisClient({
  url: process.env.REDIS_URL || "redis://localhost:6379",
});

redisClient.connect().catch(console.error);

const RATE_LIMIT_WINDOW = 60; // seconds
const MAX_REQUESTS_PER_WINDOW = 20; // max requests per IP per window

// Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const RESERVED_WORDS = new Set([
  "admin",
  "login",
  "signup",
  "stats",
  "api",
  "shorten",
  "auth",
  "logout",
]);

function isReserved(word: string): boolean {
  return RESERVED_WORDS.has(word.toLowerCase());
}

function isValidUrl(url: string): boolean {
  return isURL(url, {
    protocols: ["http", "https"],
    require_protocol: true,
    require_valid_protocol: true,
  });
}

function normalizeUrl(url: string): string {
  if (!/^https?:\/\//i.test(url)) {
    return "https://" + url;
  }
  return url;
}

function generateSlug(length = 7): string {
  return nanoid(length);
}

async function generateUniqueSlug(
  length = 7,
  maxAttempts = 5
): Promise<string> {
  let slug: string;
  let exists = true;
  let attempts = 0;

  while (exists && attempts < maxAttempts) {
    slug = generateSlug(length);

    const { data } = await supabase
      .from("urls")
      .select("id")
      .eq("short_code", slug)
      .maybeSingle();

    exists = !!data;
    attempts++;
  }

  if (exists) {
    throw new Error("Failed to generate unique slug after several attempts");
  }

  return slug!;
}

function isValidCustomAlias(alias: string): boolean {
  // Allow a-z, A-Z, 0-9, _, - and must be 3-30 chars
  return /^[a-zA-Z0-9_-]{3,30}$/.test(alias);
}

function convertLocalToUTC(localTimeString: string, timezone: string): Date {
  try {
    const parts = localTimeString.split(/[-T:]/).map(Number);
    const [year, month, day, hour, minute] = parts;
    const date = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));

    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });

    const formatted = formatter.formatToParts(date);
    const get = (type: string) =>
      Number(formatted.find((f) => f.type === type)?.value ?? "0");

    const tzDate = new Date(
      Date.UTC(
        get("year"),
        get("month") - 1,
        get("day"),
        get("hour"),
        get("minute"),
        get("second")
      )
    );

    const offset = tzDate.getTime() - date.getTime();
    const utcDate = new Date(date.getTime() - offset);
    return utcDate;
  } catch (error) {
    console.error("❌ Time conversion error:", error);
    return new Date(localTimeString + "Z");
  }
}

// Unified expiry validation

type RelativeExpiry = { count: number; unit: string };

function validateAndComputeExpiry(
  expires_at?: string,
  timezone?: string,
  relative_expiry?: RelativeExpiry
): Date | null {
  const now = new Date();

  // Constants for min and max expiry in milliseconds
  const MIN_EXPIRY_MS = 60 * 60 * 1000; // 1 hour
  const MAX_EXPIRY_MS = 3 * 30 * 24 * 60 * 60 * 1000; // approx 3 months

  let expiration: Date | null = null;

  if (expires_at) {
    const effectiveTimezone = timezone || "UTC";
    expiration = convertLocalToUTC(expires_at, effectiveTimezone);

    if (isNaN(expiration.getTime())) {
      throw new Error("Invalid expires_at format");
    }

    // NEW: Check explicitly that expiration is in the future
    if (expiration <= now) {
      throw new Error("Expiration time must be in the future");
    }
  } else if (relative_expiry) {
    const { count, unit } = relative_expiry;

    if (
      !["minutes", "hours", "days", "months", "years"].includes(unit) ||
      isNaN(count)
    ) {
      throw new Error("Invalid relative_expiry format");
    }

    expiration = add(now, { [unit]: count });
  } else {
    // No expiry specified - no expiration
    return null;
  }

  const durationMs = expiration.getTime() - now.getTime();

  if (durationMs < MIN_EXPIRY_MS || durationMs > MAX_EXPIRY_MS) {
    throw new Error(
      "Expiry duration out of bounds: minimum 1 hour, maximum 3 months"
    );
  }

  return expiration;
}

async function rateLimiter(req: Request, res: Response, next: any) {
  try {
    const ip = req.ip || req.connection.remoteAddress || "unknown";

    // Redis key for this IP and route
    const redisKey = `rate_limit:${ip}`;

    // Increment request count for this IP
    const requests = await redisClient.incr(redisKey);

    if (requests === 1) {
      // Set expiration time on first request
      await redisClient.expire(redisKey, RATE_LIMIT_WINDOW);
    }

    if (requests > MAX_REQUESTS_PER_WINDOW) {
      return res.status(429).json({
        error: `Rate limit exceeded. Try again in ${RATE_LIMIT_WINDOW} seconds.`,
      });
    }

    next();
  } catch (err) {
    console.error("Rate limiter error:", err);
    // Fail open — if Redis fails, allow the request
    next();
  }
}

type ShortenParams = {
  original_url: string;
  expires_at?: string;
  relative_expiry?: { count: number; unit: string };
  timezone?: string;
  custom_alias?: string;
  req: Request;
};

async function shortenUrl({
  original_url,
  expires_at,
  relative_expiry,
  timezone,
  custom_alias,
  req,
}: ShortenParams): Promise<{
  short_url: string;
  qr_code_url: string;
  expires_at_utc?: string;
}> {
  if (!original_url) {
    throw new Error("Missing original_url");
  }

  // Normalize and validate URL
  original_url = normalizeUrl(original_url);

  if (!isValidUrl(original_url)) {
    throw new Error("Invalid URL format");
  }

  const effectiveTimezone = timezone || req.userTimezone || "UTC";

  // Use the new unified expiry validation function here
  const expiration = validateAndComputeExpiry(
    expires_at,
    effectiveTimezone,
    relative_expiry
  );

  let short_code: string;

  if (custom_alias) {
    custom_alias = custom_alias.toLowerCase();

    if (isReserved(custom_alias)) {
      throw new Error("This custom alias is reserved and cannot be used.");
    }

    if (!isValidCustomAlias(custom_alias)) {
      throw new Error("Invalid custom alias format");
    }

    const { data: existingAlias } = await supabase
      .from("urls")
      .select("id")
      .eq("short_code", custom_alias)
      .maybeSingle();

    if (existingAlias) {
      throw new Error("Custom alias already in use");
    }

    short_code = custom_alias;
  } else {
    short_code = (await generateUniqueSlug(7)).toLowerCase();
  }

  const { data, error } = await supabase
    .from("urls")
    .insert([{ original_url, short_code, expires_at: expiration }])
    .select()
    .single();

  if (error) {
    throw new Error(error.message);
  }

  // Generate QR Code Image
  const FRONTEND_PUBLIC_URL =
    process.env.FRONTEND_PUBLIC_URL || "https://shorty-linky.vercel.app";
  const shortUrl = `${FRONTEND_PUBLIC_URL}/${data.short_code}`;

  const qrBuffer = await QRCode.toBuffer(shortUrl);

  // Upload to Supabase Bucket
  const filePath = `qr/${data.short_code}.png`;

  const { error: uploadError } = await supabase.storage
    .from("qrcodes")
    .upload(filePath, qrBuffer, {
      contentType: "image/png",
      upsert: true,
    });

  if (uploadError) {
    console.error("QR Upload Failed:", uploadError.message);
  }

  // Generate public URL
  const {
    data: { publicUrl },
  } = supabase.storage.from("qrcodes").getPublicUrl(filePath);

  // Update the row with qr_code_url
  const { error: updateError } = await supabase
    .from("urls")
    .update({ qr_code_url: publicUrl })
    .eq("short_code", data.short_code);

  if (updateError) {
    console.error("Failed to update qr_code_url:", updateError.message);
  }

  return {
    short_url: shortUrl,
    qr_code_url: publicUrl,
    expires_at_utc: expiration?.toISOString(),
  };
}

function mapErrorMessageToStatusCode(msg: string): number {
  switch (msg) {
    case "Missing original_url": // 400
    case "Invalid URL format": // 400
    case "Invalid expires_at format": // 400
    case "Expiration time must be in the future": // 400
    case "Invalid relative_expiry format": // 400
    case "Invalid custom alias format": // 400
    case "Expiry duration out of bounds: minimum 1 hour, maximum 3 months":
      return 400;

    case "This custom alias is reserved and cannot be used.": // 403
      return 403;

    case "Custom alias already in use": // 409
      return 409;

    default: // 500 for unknown / DB errors
      return 500;
  }
}

app.post("/shorten", rateLimiter, async (req: Request, res: Response) => {
  try {
    const result = await shortenUrl({ ...req.body, req });
    return res.status(201).json(result);
  } catch (error: any) {
    const msg = error.message || "Internal server error";
    const status = mapErrorMessageToStatusCode(msg);
    return res.status(status).json({ error: msg });
  }
});

// Bulk API Endpoint
app.post("/bulk-shorten", rateLimiter, async (req: Request, res: Response) => {
  const entries = req.body.urls;

  if (!Array.isArray(entries)) {
    return res
      .status(400)
      .json({ error: "Expected an array of URLs in 'urls' field." });
  }

  const results = [];

  for (const entry of entries) {
    try {
      const result = await shortenUrl({ ...entry, req });
      results.push({
        success: true,
        original_url: entry.original_url,
        short_url: result.short_url,
        qr_code_url: result.qr_code_url,
        expires_at_utc: result.expires_at_utc,
      });
    } catch (error: any) {
      const errorMsg = error.message || "Internal server error";
      results.push({
        success: false,
        original_url: entry.original_url,
        error: errorMsg,
        error_code: mapErrorMessageToStatusCode(errorMsg),
      });
    }
  }

  return res.status(207).json({ results });
});

// Stats endpoint
app.get("/stats/:slug", async (req: Request, res: Response) => {
  const slug = req.params.slug.toLowerCase();

  const { data, error } = await supabase
    .from("urls")
    .select("*")
    .eq("short_code", slug)
    .single();

  if (error || !data) {
    return res.status(404).json({ message: "URL not found" });
  }

  res.status(200).json({ stats: data });
});

// Redirect route
app.get("/:slug", async (req, res) => {
  const { slug } = req.params;

  const { data, error } = await supabase
    .from("urls")
    .select("original_url, clicks, expires_at")
    .eq("short_code", slug)
    .single();

  if (error || !data) {
    // Check if it's an API request
    if (
      req.headers.accept?.includes("application/json") ||
      req.headers["x-requested-with"]
    ) {
      return res.status(404).json({ error: "Not found" });
    }
    // For browser requests, redirect to your React app's 404 page
    return res.redirect(`${process.env.FRONTEND_PUBLIC_URL}/not-found`);
  }

  const now = new Date();
  if (data.expires_at && new Date(data.expires_at) < now) {
    if (
      req.headers.accept?.includes("application/json") ||
      req.headers["x-requested-with"]
    ) {
      return res.status(410).json({ error: "This link has expired." });
    }
    return res.redirect(`${process.env.FRONTEND_PUBLIC_URL}/expired`);
  }

  // Update click count
  supabase
    .from("urls")
    .update({ clicks: (data.clicks || 0) + 1 })
    .eq("short_code", slug)
    .then(({ error: updateError }) => {
      if (updateError) {
        console.error("Failed to update click count:", updateError.message);
      }
    });

  // Check if it's an API request
  if (
    req.headers.accept?.includes("application/json") ||
    req.headers["x-requested-with"]
  ) {
    return res.json({ original_url: data.original_url });
  }

  // For browser requests, redirect directly
  return res.redirect(data.original_url);
});
// Cron DB cleaning
cron.schedule("0 */8 * * *", async () => {
  const now = new Date().toISOString();
  console.log(`🔍 Checking for expired URLs at ${now}`);

  // 1. First, fetch the expired URLs with their short_code
  const { data: expiredUrls, error: fetchError } = await supabase
    .from("urls")
    .select("short_code")
    .lt("expires_at", now);

  if (fetchError) {
    console.error("❌ Error fetching expired URLs:", fetchError.message);
    return;
  }

  // 2. If any expired, try to delete the QR images from storage
  if (expiredUrls && expiredUrls.length > 0) {
    const qrPaths = expiredUrls.map((url) => `qr/${url.short_code}.png`);

    const { error: storageError } = await supabase.storage
      .from("qrcodes")
      .remove(qrPaths);

    if (storageError) {
      console.error("❌ Error deleting QR codes:", storageError.message);
    } else {
      console.log(`🧹 Deleted ${qrPaths.length} QR code image(s)`);
    }

    // 3. Then delete the rows from the "urls" table
    const { error: deleteError } = await supabase
      .from("urls")
      .delete()
      .in(
        "short_code",
        expiredUrls.map((url) => url.short_code)
      );

    if (deleteError) {
      console.error("❌ Error deleting expired URL rows:", deleteError.message);
    } else {
      console.log(`✅ Deleted ${expiredUrls.length} expired URL(s)`);
    }
  } else {
    console.log("ℹ️ No expired URLs found.");
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`✅ Backend server is running at http://localhost:${PORT}`);
});

app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok" });
});
