// Intl.RelativeTimeFormat "long" style: full words, e.g. "in 2 hours 30 minutes".
export function formatTimeUntilLong(expiresAt: Date, now: Date = new Date()): string {
  const diffMs = expiresAt.getTime() - now.getTime();

  if (diffMs <= 0) {
    return "in 0 minutes";
  }

  const diffMins = Math.max(1, Math.ceil(diffMs / (1000 * 60)));

  if (diffMins < 60) {
    return `in ${diffMins} minute${diffMins !== 1 ? "s" : ""}`;
  }

  const diffHours = Math.floor(diffMins / 60);
  const remainingMins = diffMins % 60;

  if (diffHours < 24) {
    if (remainingMins > 0) {
      return `in ${diffHours} hour${diffHours !== 1 ? "s" : ""} ${remainingMins} minute${remainingMins !== 1 ? "s" : ""}`;
    }
    return `in ${diffHours} hour${diffHours !== 1 ? "s" : ""}`;
  }

  const diffDays = Math.floor(diffHours / 24);
  const remainingHours = diffHours % 24;

  if (remainingHours > 0) {
    return `in ${diffDays} day${diffDays !== 1 ? "s" : ""} ${remainingHours} hour${remainingHours !== 1 ? "s" : ""}`;
  }
  return `in ${diffDays} day${diffDays !== 1 ? "s" : ""}`;
}

// Intl.RelativeTimeFormat "narrow" style: bare unit letters, e.g. "in 2h 30m".
export function formatTimeUntilNarrow(nextRegenAt: Date, now: Date): string {
  const minutes = Math.ceil((nextRegenAt.getTime() - now.getTime()) / 60_000);
  if (minutes <= 0) return "now";
  if (minutes < 60) return `in ${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `in ${hours}h${minutes % 60 === 0 ? "" : ` ${minutes % 60}m`}`;
  const days = Math.floor(hours / 24);
  return `in ${days}d${hours % 24 === 0 ? "" : ` ${hours % 24}h`}`;
}

export function formatTimeAgo(occurredAt: Date, now: Date = new Date()): string {
  const elapsedMs = Math.max(0, now.getTime() - occurredAt.getTime());
  const elapsedMinutes = Math.floor(elapsedMs / (1000 * 60));

  if (elapsedMinutes < 1) return "just now";
  if (elapsedMinutes < 60) return `${elapsedMinutes} ${pluralize("minute", elapsedMinutes)} ago`;

  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) return `${elapsedHours} ${pluralize("hour", elapsedHours)} ago`;

  const elapsedDays = Math.floor(elapsedHours / 24);
  if (elapsedDays < 30) return `${elapsedDays} ${pluralize("day", elapsedDays)} ago`;

  if (elapsedDays < 365) {
    const elapsedMonths = Math.floor(elapsedDays / 30);
    return `${elapsedMonths} ${pluralize("month", elapsedMonths)} ago`;
  }

  const elapsedYears = Math.floor(elapsedDays / 365);
  return `${elapsedYears} ${pluralize("year", elapsedYears)} ago`;
}

function pluralize(unit: string, count: number): string {
  return count === 1 ? unit : `${unit}s`;
}
