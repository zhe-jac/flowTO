import type { Feature, FeatureCollection, LineString } from "geojson";

export type RoadProperties = {
  id: string;
  name: string;
  roadClass: string;
  direction: string;
  lengthM: number;
  flow: "clear" | "moderate" | "slow";
};

export type Road = Feature<LineString, RoadProperties>;
export type RoadCollection = FeatureCollection<LineString, RoadProperties>;
export type Tool = "inspect" | "close" | "erase";

export type Scenario = {
  version: 1;
  name: string;
  closedRoadIds: string[];
};
