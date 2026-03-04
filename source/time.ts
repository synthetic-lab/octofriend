export function formatTimeUntil(expiresAt: Date, now: Date = new Date()): string {
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
