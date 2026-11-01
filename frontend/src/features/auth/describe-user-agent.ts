const BROWSERS: [RegExp, string][] = [
  [/Edg\//, "Edge"],
  [/OPR\//, "Opera"],
  [/Firefox\//, "Firefox"],
  [/Chrome\//, "Chrome"],
  [/Safari\//, "Safari"],
];
const SYSTEMS: [RegExp, string][] = [
  [/Android/, "Android"],
  [/iPhone|iPad/, "iOS"],
  [/Windows/, "Windows"],
  [/Mac OS X/, "macOS"],
  [/Linux/, "Linux"],
];

const match = (value: string, patterns: [RegExp, string][]) =>
  patterns.find(([pattern]) => pattern.test(value))?.[1];

export function describeUserAgent(userAgent: string | null) {
  if (!userAgent) return "Unknown device";
  const browser = match(userAgent, BROWSERS);
  const system = match(userAgent, SYSTEMS);
  if (browser && system) return `${browser} on ${system}`;
  return browser ?? system ?? "Unknown device";
}
