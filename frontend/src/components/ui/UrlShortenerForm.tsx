import { useState } from "react";
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

export default function ShortenForm() {
  // Form state
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

  // Feedback state
  const [error, setError] = useState<string | null>(null);
  const [successData, setSuccessData] = useState<{
    short_url: string;
    qr_code_url: string;
    expires_at_utc?: string;
  } | null>(null);

  // Helper to combine date and time into ISO string for definitive expiry
  function getExpiryIso() {
    if (!date) return null;
    // Format date to yyyy-MM-dd
    const yyyy = date.getFullYear();
    const mm = (date.getMonth() + 1).toString().padStart(2, "0");
    const dd = date.getDate().toString().padStart(2, "0");
    return `${yyyy}-${mm}-${dd}T${time}`;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    setError(null);
    setSuccessData(null);

    if (!originalUrl) {
      setError("Please enter a URL to shorten.");
      return;
    }

    // Prepare payload
    const payload: any = {
      original_url: originalUrl.trim(),
    };

    if (customAlias.trim()) {
      payload.custom_alias = customAlias.trim();
    }

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
        payload.relative_expiry = {
          count: Number(amount),
          unit,
        };
      } else {
        setError("Please select an expiry type.");
        return;
      }
    }

    try {
      const res = await fetch("http://localhost:3000/shorten", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Unknown error occurred.");
        return;
      }

      // Success
      setSuccessData({
        short_url: data.short_url,
        qr_code_url: data.qr_code_url,
        expires_at_utc: data.expires_at_utc,
      });

      // Optionally reset form or leave as-is
    } catch (err: any) {
      setError(err.message || "Failed to connect to the server.");
    }
  }

  return (
    <form onSubmit={handleSubmit} className="max-w-xl mx-auto p-6 space-y-6">
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
          onCheckedChange={setIsExpiring}
        />
      </div>

      {isExpiring && (
        <div className="space-y-4">
          <div className="flex gap-2">
            <Toggle
              pressed={expiryType === "definitive"}
              onPressedChange={(pressed) =>
                setExpiryType(pressed ? "definitive" : null)
              }
              variant="outline"
            >
              Definitive
            </Toggle>
            <Toggle
              pressed={expiryType === "relative"}
              onPressedChange={(pressed) =>
                setExpiryType(pressed ? "relative" : null)
              }
              variant="outline"
            >
              Relative
            </Toggle>
          </div>

          {expiryType === "definitive" && (
            <>
              <div className="flex gap-4">
                <div className="flex flex-col gap-2">
                  <Label>Date</Label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        className="w-32 justify-between font-normal"
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

                <div className="flex flex-col gap-2">
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
                  className="w-48"
                />
              </div>
            </>
          )}

          {expiryType === "relative" && (
            <div className="flex gap-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="amount">Amount</Label>
                <Input
                  id="amount"
                  type="number"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="unit">Unit</Label>
                <Select value={unit} onValueChange={setUnit}>
                  <SelectTrigger className="w-32">
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

      {/* Success alert */}
      {successData && (
        <Alert
          variant="default"
          className="mt-4 border-green-500 bg-green-50 text-green-700"
        >
          <CheckCircle className="h-4 w-4" />
          <AlertTitle>Short URL Created!</AlertTitle>
          <AlertDescription>
            <a
              href={successData.short_url}
              target="_blank"
              rel="noopener noreferrer"
              className="underline text-blue-600"
            >
              {successData.short_url}
            </a>
            <br />
            {successData.expires_at_utc && (
              <small>Expires at (UTC): {successData.expires_at_utc}</small>
            )}
            <br />
            <img
              src={successData.qr_code_url}
              alt="QR code"
              className="mt-2 w-32 h-32"
            />
          </AlertDescription>
        </Alert>
      )}

      <Button type="submit" className="mt-4 w-full">
        Shorten
      </Button>
    </form>
  );
}
