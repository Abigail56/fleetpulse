import {
  Bell,
  Bus,
  Building2,
  Car,
  ClipboardCheck,
  Fuel,
  GraduationCap,
  HardHat,
  Landmark,
  MapPin,
  Package,
  Route,
  Truck,
  UserRound,
  Workflow,
  Wrench,
  BarChart3,
  Warehouse,
  type LucideIcon,
} from "lucide-react";

export type FeatureGroup = {
  id: string;
  title: string;
  summary: string;
  items: { icon: LucideIcon; title: string; body: string }[];
};

export const FEATURE_GROUPS: FeatureGroup[] = [
  {
    id: "visibility",
    title: "Fleet visibility",
    summary: "Know where vehicles are and how current that information is.",
    items: [
      {
        icon: MapPin,
        title: "GPS tracking",
        body: "Connects to GPS providers through adapters, recording position, speed, heading and ignition where the device reports them.",
      },
      {
        icon: Route,
        title: "Live map and trip history",
        body: "See last-known locations, filter vehicles and review past routes. Old GPS data is marked as stale.",
      },
      {
        icon: Truck,
        title: "Vehicles and drivers",
        body: "Keep one record of each vehicle and driver, including assignments, status, licences and history.",
      },
    ],
  },
  {
    id: "intelligence",
    title: "Fleet intelligence",
    summary: "Turn operating records into decisions about cost and use.",
    items: [
      {
        icon: Fuel,
        title: "Fuel and expenses",
        body: "Record fuel and other costs with receipts and approval, in multiple currencies, with cost per kilometre where the data allows.",
      },
      {
        icon: Wrench,
        title: "Maintenance",
        body: "Schedule service by date or odometer, manage work orders and keep a full service history.",
      },
      {
        icon: BarChart3,
        title: "Reports",
        body: "Report on utilisation, trips, fuel, maintenance costs and compliance, with CSV and PDF exports.",
      },
    ],
  },
  {
    id: "automation",
    title: "Operational automation",
    summary: "Catch what needs attention without watching a screen all day.",
    items: [
      {
        icon: Bell,
        title: "Alerts and geofences",
        body: "Get alerts for geofence entries and exits, speeding, vehicles that stop reporting, and upcoming maintenance.",
      },
      {
        icon: ClipboardCheck,
        title: "Inspections and compliance",
        body: "Run vehicle inspections, record defects, and get reminders before insurance, licences and other documents expire.",
      },
      {
        icon: Workflow,
        title: "Automation rules",
        body: "Set rules such as notifying a fleet manager when insurance expires within 30 days, with a record of every run.",
      },
    ],
  },
];

export const SOLUTIONS: { icon: LucideIcon; title: string; need: string }[] = [
  {
    icon: Package,
    title: "Logistics and delivery",
    need: "Plan and dispatch trips, follow vehicles on the road, and see what each route costs.",
  },
  {
    icon: Bus,
    title: "Transportation",
    need: "Keep vehicles roadworthy and in service, with maintenance and compliance in one place.",
  },
  {
    icon: Warehouse,
    title: "Distribution",
    need: "Assign drivers and vehicles to regular routes, and compare fuel use across the fleet.",
  },
  {
    icon: HardHat,
    title: "Construction",
    need: "Track trucks and heavy equipment across sites, using geofences to see arrivals and departures.",
  },
  {
    icon: Building2,
    title: "Corporate fleets",
    need: "Control who uses which vehicle and keep expense approvals and records in order.",
  },
  {
    icon: Car,
    title: "Car rental",
    need: "See where vehicles are, keep service schedules on track, and stay ahead of document expiry.",
  },
  {
    icon: GraduationCap,
    title: "Schools and institutions",
    need: "Manage buses and drivers, keep licences and inspections current, and review journeys.",
  },
  {
    icon: UserRound,
    title: "Field service",
    need: "Know which vehicle is closest to a job and how much time vehicles spend in use.",
  },
  {
    icon: Landmark,
    title: "Government fleets",
    need: "Keep an audit trail of changes, with role-based access across departments.",
  },
];
