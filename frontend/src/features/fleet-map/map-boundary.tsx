"use client";

import { Component, type ReactNode } from "react";

/** The map needs WebGL, which not every device has. */
export class MapBoundary extends Component<
  { fallback: ReactNode; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.warn("fleet_map_unavailable:", error);
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
