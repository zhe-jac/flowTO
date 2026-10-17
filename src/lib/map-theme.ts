import { blendValue } from "./daylight";

export const MAP_PALETTE = {
  land: "#edf5fa",
  water: "#8bc8ed",
  greenspace: "#d5e8df",
  buildings: "#c3deef",
  roads: "#fbfdff",
  trunks: "#e0edf5",
  motorways: "#ccdfed",
  roadLabels: "#36566d",
  placeLabels: "#536f83",
  commercial: "#e6f0f6",
  medical: "#e1eef6",
  education: "#e0eee9",
  industrial: "#dce9f0",
};

export const MAP_NIGHT_PALETTE: Record<keyof typeof MAP_PALETTE, string> = {
  land: "#152536",
  water: "#0d2335",
  greenspace: "#19382f",
  buildings: "#718fa8",
  roads: "#344d61",
  trunks: "#3b556a",
  motorways: "#48647a",
  roadLabels: "#c0d6e6",
  placeLabels: "#a9c5d9",
  commercial: "#1b3043",
  medical: "#20384b",
  education: "#203c3e",
  industrial: "#233445",
};

export const MAPBOX_BASEMAP_CONFIG = {
  theme: "default",
  lightPreset: "day",
  showPointOfInterestLabels: false,
  showLandmarkIcons: false,
  showLandmarkIconLabels: false,
  showIndoorLabels: false,
  showAdminBoundaries: false,
  showPlaceLabels: true,
  // Off because Standard's road labels include highway shields that ignore the boundary clip; Mapbox draws its own
  // Toronto-only street names instead.
  showRoadLabels: false,
  showTransitLabels: true,
  show3dObjects: false,
  show3dBuildings: true,
  show3dFacades: true,
  show3dLandmarks: true,
  show3dTrees: true,
  colorLand: MAP_PALETTE.land,
  colorWater: MAP_PALETTE.water,
  colorGreenspace: MAP_PALETTE.greenspace,
  colorBuildings: MAP_PALETTE.buildings,
  colorRoads: MAP_PALETTE.roads,
  colorTrunks: MAP_PALETTE.trunks,
  colorMotorways: MAP_PALETTE.motorways,
  colorRoadLabels: MAP_PALETTE.roadLabels,
  colorPlaceLabels: MAP_PALETTE.placeLabels,
  colorCommercial: MAP_PALETTE.commercial,
  colorMedical: MAP_PALETTE.medical,
  colorEducation: MAP_PALETTE.education,
  colorIndustrial: MAP_PALETTE.industrial,
};

/** Standard colour settings blended between the night (0) and day (1) palettes. */
export function mapboxBasemapColors(daylight: number) {
  return Object.fromEntries(Object.entries(MAP_PALETTE).map(([name, day]) => {
    const night = MAP_NIGHT_PALETTE[name as keyof typeof MAP_PALETTE];
    return [`color${name[0].toUpperCase()}${name.slice(1)}`, blendValue(night, day, daylight)];
  }));
}

export function mapboxBasemapConfig(theme: "day" | "night") {
  const palette = theme === "night" ? MAP_NIGHT_PALETTE : MAP_PALETTE;
  return {
    ...MAPBOX_BASEMAP_CONFIG,
    lightPreset: theme,
    ...Object.fromEntries(Object.entries(palette).map(([name, value]) => [`color${name[0].toUpperCase()}${name.slice(1)}`, value])),
  };
}
