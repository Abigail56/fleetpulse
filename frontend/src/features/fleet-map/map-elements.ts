import { formatAge } from "./demo-fleet";
import { STATUS_LABELS, type FleetVehicle } from "./types";

export function createFleetMarkerElement(vehicle: FleetVehicle, leafletIcon = false) {
  const element = document.createElement(leafletIcon ? "span" : "button");
  if (element instanceof HTMLButtonElement) element.type = "button";
  if (leafletIcon) element.setAttribute("aria-hidden", "true");
  element.className = `fleet-marker fleet-marker--${vehicle.status}`;
  if (!leafletIcon) {
    element.setAttribute("aria-label", `${vehicle.id}, ${STATUS_LABELS[vehicle.status]}`);
  }
  element.style.setProperty("--heading", `${vehicle.headingDegrees}deg`);

  const dot = document.createElement("span");
  dot.className = "fleet-marker__dot";
  const arrow = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  arrow.setAttribute("viewBox", "0 0 12 12");
  arrow.setAttribute("aria-hidden", "true");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", "M6 1 10.5 10 6 8 1.5 10z");
  arrow.append(path);
  dot.append(arrow);

  const label = document.createElement("span");
  label.className = "fleet-marker__label";
  label.textContent = vehicle.id;
  element.append(dot, label);
  return element;
}

export function createFleetPopupContent(vehicle: FleetVehicle) {
  const root = document.createElement("div");
  root.className = "fleet-popup";
  const title = document.createElement("p");
  title.className = "fleet-popup__title";
  title.textContent = `${vehicle.id} · ${vehicle.description}`;
  root.append(title);
  const rows: [string, string][] = [
    ["Status", STATUS_LABELS[vehicle.status]],
    ["Speed", vehicle.speedKph === null ? "Not reported" : `${vehicle.speedKph} km/h`],
    ["Last update", formatAge(vehicle.secondsSinceUpdate)],
    ["Location", vehicle.locationName],
  ];
  if (vehicle.destination) rows.push(["Destination", vehicle.destination]);
  for (const [label, value] of rows) {
    const row = document.createElement("p");
    const name = document.createElement("span");
    name.textContent = `${label}: `;
    row.append(name, document.createTextNode(value));
    root.append(row);
  }
  return root;
}
