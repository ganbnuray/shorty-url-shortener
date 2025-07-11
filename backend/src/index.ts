import express, { Request, Response } from "express";
import cors from "cors";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { add } from "date-fns";
import cron from "node-cron";
import isURL from "validator/lib/isURL";
import { nanoid } from "nanoid";
import { createClient as createRedisClient } from "redis";
import QRCode from "qrcode";

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
const MAX_REQUESTS_PER_WINDOW = 10; // max requests per IP per window

// Supabase client
const supabase = createClient(
  process.env.VITE_SUPABASE_URL!,
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

// Shorten URL route
app.post(
  "/shorten",
  rateLimiter,
  async (req: Request, res: Response): Promise<Response> => {
    let { original_url, expires_at, relative_expiry, timezone, custom_alias } =
      req.body;

    if (!original_url) {
      return res.status(400).json({ error: "Missing original_url" });
    }

    // Normalize and validate URL
    original_url = normalizeUrl(original_url);

    if (!isValidUrl(original_url)) {
      return res.status(400).json({ error: "Invalid URL format" });
    }

    const effectiveTimezone = timezone || req.userTimezone || "UTC";
    let expiration: Date | null = null;

    if (expires_at) {
      expiration = convertLocalToUTC(expires_at, effectiveTimezone);
      if (isNaN(expiration.getTime())) {
        return res.status(400).json({ error: "Invalid expires_at format" });
      }
      if (expiration <= new Date()) {
        return res
          .status(400)
          .json({ error: "Expiration time must be in the future" });
      }
    } else if (relative_expiry) {
      const now = new Date();
      const { count, unit } = relative_expiry;

      if (
        !["days", "months", "years", "minutes", "hours"].includes(unit) ||
        isNaN(count)
      ) {
        return res
          .status(400)
          .json({ error: "Invalid relative_expiry format" });
      }

      expiration = add(now, { [unit]: count });
    }

    let short_code: string;

    if (custom_alias) {
      custom_alias = custom_alias.toLowerCase();

      if (isReserved(custom_alias)) {
        return res
          .status(403)
          .json({ error: "This custom alias is reserved and cannot be used." });
      }

      if (!isValidCustomAlias(custom_alias)) {
        return res.status(400).json({ error: "Invalid custom alias format" });
      }

      const { data: existingAlias } = await supabase
        .from("urls")
        .select("id")
        .eq("short_code", custom_alias)
        .maybeSingle();

      if (existingAlias) {
        return res.status(409).json({ error: "Custom alias already in use" });
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
      return res.status(500).json({ error: error.message });
    }

    // Generate QR Code Image
    const shortUrl = `http://localhost:3000/${data.short_code}`;
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

    return res.status(201).json({
      short_url: `http://localhost:3000/${data.short_code}`,
      qr_code_url: publicUrl,
      expires_at_utc: expiration?.toISOString(),
    });
  }
);

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
app.get("/:slug", async (req, res): Promise<any> => {
  const { slug } = req.params;

  const { data, error } = await supabase
    .from("urls")
    .select("original_url, clicks, expires_at")
    .eq("short_code", slug)
    .single();

  if (error || !data) return res.status(404).json({ error: "Not found" });

  const now = new Date();
  if (data.expires_at && new Date(data.expires_at) < now) {
    console.log(
      `🚫 URL ${slug} expired at ${
        data.expires_at
      }, current time: ${now.toISOString()}`
    );
    return res.status(410).json({ error: "This link has expired." });
  }

  const { error: updateError } = await supabase
    .from("urls")
    .update({ clicks: (data.clicks || 0) + 1 })
    .eq("short_code", slug);

  if (updateError) {
    console.error("Failed to update click count:", updateError.message);
  }

  res.redirect(data.original_url);
});

cron.schedule("*/2 * * * *", async () => {
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
