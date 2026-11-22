export type MapTheme = "light" | "dark";

export type GeoapifyMapStyle = "positron" | "osm-bright" | "dark-matter";
export type MapStylePreference = "auto" | GeoapifyMapStyle;

const MAP_STYLE_STORAGE_KEY = "fleetpulse-map-style";
const MAP_STYLE_CHANGE_EVENT = "fleetpulse-map-style-change";

function isMapStylePreference(value: string | null): value is MapStylePreference {
  return (
    value === "auto" ||
    value === "positron" ||
    value === "osm-bright" ||
    value === "dark-matter"
  );
}

export function getMapStylePreference(): MapStylePreference {
  try {
    const saved = window.localStorage.getItem(MAP_STYLE_STORAGE_KEY);
    return isMapStylePreference(saved) ? saved : "auto";
  } catch (error) {
    console.warn("map_style_preference_read_failed:", error);
    return "auto";
  }
}

export function subscribeToMapStylePreference(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(MAP_STYLE_CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(MAP_STYLE_CHANGE_EVENT, onChange);
  };
}

export function saveMapStylePreference(preference: MapStylePreference) {
  try {
    window.localStorage.setItem(MAP_STYLE_STORAGE_KEY, preference);
  } catch (error) {
    console.warn("map_style_preference_write_failed:", error);
  }
  window.dispatchEvent(new Event(MAP_STYLE_CHANGE_EVENT));
}

export function getServerMapStylePreference(): MapStylePreference {
  return "auto";
}

export function getFleetMapStyleUrl(theme: MapTheme) {
  const key = process.env.NEXT_PUBLIC_GEOAPIFY_API_KEY;
  const customStyle = process.env.NEXT_PUBLIC_MAP_STYLE_URL;

  if (key) return getGeoapifyMapStyleUrl(key, theme);
  if (customStyle) return customStyle;

  return `https://tiles.openfreemap.org/styles/${theme === "dark" ? "dark" : "bright"}`;
}

export function getGeoapifyMapStyleUrl(
  key: string,
  theme: MapTheme,
  preference: "auto" | GeoapifyMapStyle = "auto",
) {
  const style =
    preference === "auto" ? (theme === "dark" ? "dark-matter" : "positron") : preference;
  const url = new URL(`https://maps.geoapify.com/v1/styles/${style}/style.json`);
  url.searchParams.set("apiKey", key);
  return url.toString();
}
