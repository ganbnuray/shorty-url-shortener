"use client";

import { useState } from "react";
import { ClipboardCopy, Check, Download } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Toggle } from "@/components/ui/toggle";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import { ChevronDownIcon } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TimezoneCombobox } from "@/components/ui/timezone-combobox";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertCircle, CheckCircle } from "lucide-react";
import { Loader2 } from "lucide-react";

export default function ShortenForm() {
  const [originalUrl, setOriginalUrl] = useState("");
  const [isExpiring, setIsExpiring] = useState(false);
  const [expiryType, setExpiryType] = useState<
    "definitive" | "relative" | null
  >(null);
  const [date, setDate] = useState<Date | undefined>(undefined);
  const [time, setTime] = useState("10:30:00");
  const [timezone, setTimezone] = useState<string>("UTC");
  const [amount, setAmount] = useState<string>("");
  const [unit, setUnit] = useState<string>("days");
  const [customAlias, setCustomAlias] = useState("");

  const [error, setError] = useState<string | null>(null);
  const [successData, setSuccessData] = useState<{
    short_url: string;
    qr_code_url: string;
    expires_at_utc?: string;
  } | null>(null);
  const [loading, setLoading] = useState(false);

  const API_BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:3000";

  function getExpiryIso() {
    if (!date) return null;
    const yyyy = date.getFullYear();
    const mm = (date.getMonth() + 1).toString().padStart(2, "0");
    const dd = date.getDate().toString().padStart(2, "0");
    return `${yyyy}-${mm}-${dd}T${time}`;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccessData(null);
    setLoading(true);

    if (!originalUrl) {
      setError("Please enter a URL to shorten.");
      return;
    }

    const payload: any = { original_url: originalUrl.trim() };

    if (customAlias.trim()) payload.custom_alias = customAlias.trim();

    if (isExpiring) {
      if (expiryType === "definitive") {
        const expiryIso = getExpiryIso();
        if (!expiryIso) {
          setError("Please select a valid expiry date.");
          return;
        }
        payload.expires_at = expiryIso;
        payload.timezone = timezone;
      } else if (expiryType === "relative") {
        if (!amount || Number(amount) <= 0) {
          setError("Please enter a positive amount for relative expiry.");
          return;
        }
        payload.relative_expiry = { count: Number(amount), unit };
      } else {
        setError("Please select an expiry type.");
        return;
      }
    }

    try {
      const res = await fetch(`${API_BASE_URL}/shorten`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Unknown error occurred.");
        return;
      }

      setSuccessData({
        short_url: data.short_url,
        qr_code_url: data.qr_code_url,
        expires_at_utc: data.expires_at_utc,
      });
    } catch (err: any) {
      setError(err.message || "Failed to connect to the server.");
    } finally {
      setLoading(false);
    }
  }

  const [copied, setCopied] = useState(false);

  function copyToClipboard() {
    if (successData?.short_url) {
      navigator.clipboard.writeText(successData.short_url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000); // Reset copy feedback after 2s
    }
  }

  function downloadQRCode() {
    if (!successData?.qr_code_url) return;

    // Create a temporary <a> element and click it to download
    const link = document.createElement("a");
    link.href = successData.qr_code_url;
    link.download = "qr-code.png"; // file name
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 flex flex-col sm:flex-row gap-8">
      {/* Form */}
      <form onSubmit={handleSubmit} className="flex-1 max-w-xl space-y-6">
        <h1 className="text-2xl font-bold">Shorten your link</h1>

        <div className="space-y-2">
          <Label htmlFor="original-url">Original URL</Label>
          <Input
            id="original-url"
            placeholder="Enter the URL to shorten"
            value={originalUrl}
            onChange={(e) => setOriginalUrl(e.target.value)}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="custom-alias">Custom Alias (optional)</Label>
          <Input
            id="custom-alias"
            placeholder="Enter custom alias"
            value={customAlias}
            onChange={(e) => setCustomAlias(e.target.value)}
          />
        </div>

        <div className="flex items-center justify-between">
          <Label htmlFor="expiring-switch">Expiring Link</Label>
          <Switch
            id="expiring-switch"
            checked={isExpiring}
            onCheckedChange={(checked) => {
              setIsExpiring(checked);
              if (checked && !expiryType) setExpiryType("definitive");
            }}
          />
        </div>

        {isExpiring && (
          <div className="space-y-4">
            <div className="flex gap-2">
              <Toggle
                pressed={expiryType === "definitive"}
                onPressedChange={(pressed) => {
                  if (pressed) setExpiryType("definitive");
                  else if (expiryType === "definitive")
                    setExpiryType("relative");
                }}
                variant="outline"
              >
                Definitive
              </Toggle>
              <Toggle
                pressed={expiryType === "relative"}
                onPressedChange={(pressed) => {
                  if (pressed) setExpiryType("relative");
                  else if (expiryType === "relative")
                    setExpiryType("definitive");
                }}
                variant="outline"
              >
                Relative
              </Toggle>
            </div>

            {expiryType === "definitive" && (
              <>
                <div className="flex flex-col sm:flex-row gap-4 w-full">
                  <div className="flex flex-col gap-2 w-full sm:max-w-xs">
                    <Label>Date</Label>
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button
                          variant="outline"
                          className="w-full justify-between font-normal"
                        >
                          {date ? date.toLocaleDateString() : "Select date"}
                          <ChevronDownIcon className="ml-2 h-4 w-4" />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0">
                        <Calendar
                          mode="single"
                          selected={date}
                          onSelect={(d) => setDate(d)}
                        />
                      </PopoverContent>
                    </Popover>
                  </div>

                  <div className="flex flex-col gap-2 w-full sm:max-w-xs">
                    <Label>Timezone</Label>
                    <TimezoneCombobox value={timezone} onChange={setTimezone} />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="time-picker">Time</Label>
                  <Input
                    type="time"
                    id="time-picker"
                    step="1"
                    value={time}
                    onChange={(e) => setTime(e.target.value)}
                    className="w-full sm:w-48"
                  />
                </div>
              </>
            )}

            {expiryType === "relative" && (
              <div className="flex flex-col sm:flex-row gap-4 w-full">
                <div className="flex flex-col gap-2 w-full sm:max-w-xs">
                  <Label htmlFor="amount">Amount</Label>
                  <Input
                    id="amount"
                    type="number"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-2 w-full sm:max-w-xs">
                  <Label htmlFor="unit">Unit</Label>
                  <Select value={unit} onValueChange={setUnit}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Select unit" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="hours">Hours</SelectItem>
                      <SelectItem value="days">Days</SelectItem>
                      <SelectItem value="months">Months</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Error alert */}
        {error && (
          <Alert variant="destructive" className="mt-4">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Error</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {/* Success alert message only */}
        {successData && (
          <Alert
            variant="default"
            className="mt-4 border-green-500 bg-green-50 text-green-700 flex items-center gap-2 px-4 py-2"
          >
            <div className="flex items-center justify-center h-5 w-5">
              <CheckCircle className="h-5 w-5" />
            </div>
            <span className="text-sm font-semibold leading-none">
              Short URL Created!
            </span>
          </Alert>
        )}

        <Button type="submit" className="mt-4 w-full" disabled={loading}>
          {loading ? (
            <>
              <Loader2 className="animate-spin mr-2 h-4 w-4" />
              Shortening...
            </>
          ) : (
            "Shorten"
          )}
        </Button>
      </form>

      {/* Result details container */}
      {successData && (
        <div className="flex-1 max-w-xl space-y-6">
          <h2 className="text-2xl font-bold">Shortened Link Details</h2>

          <div className="flex flex-col items-start gap-2">
            <img
              src={successData.qr_code_url}
              alt="QR code"
              style={{
                borderColor: "rgb(34 197 94 / var(--tw-border-opacity, 1))",
              }}
              className="w-40 h-40 rounded-lg border-8"
            />

            <button
              type="button"
              onClick={downloadQRCode}
              style={{ backgroundColor: `hsl(var(--accent))` }}
              className="inline-flex items-center gap-2 px-5 py-2 mt-4 text-black font-bold rounded-xl hover:bg-gray-400 transition"
            >
              <Download className="w-4 h-4" />
              Download QR Code
            </button>
          </div>

          <div className="flex flex-col w-full max-w-md">
            <label
              htmlFor="shortened-url"
              className="mb-1 font-semibold text-gray-700"
            >
              Shortened URL
            </label>
            <div className="relative">
              <input
                id="shortened-url"
                type="text"
                readOnly
                value={successData.short_url}
                className="w-full pr-12 py-2 pl-3 border border-gray-300 rounded-md text-black cursor-pointer select-all"
                onClick={(e) => (e.currentTarget as HTMLInputElement).select()}
                aria-label="Shortened URL"
              />
              <button
                onClick={copyToClipboard}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-gray-200"
                aria-label="Copy shortened URL"
                type="button"
              >
                {copied ? (
                  <Check className="text-green-600 w-5 h-5" />
                ) : (
                  <ClipboardCopy className="w-5 h-5" />
                )}
              </button>
            </div>
          </div>

          {successData.expires_at_utc && (
            <div className="text-gray-600 text-sm">
              Expires at (UTC):{" "}
              {new Date(successData.expires_at_utc).toLocaleString("en-US", {
                weekday: "short", // e.g., "Mon"
                year: "numeric", // e.g., "2025"
                month: "short", // e.g., "Jul"
                day: "numeric", // e.g., "15"
                hour: "2-digit", // e.g., "03 PM"
                minute: "2-digit", // e.g., "04"
                second: "2-digit", // e.g., "30"
                timeZone: "UTC",
                hour12: true, //24-hour vs AM/PM
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
