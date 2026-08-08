// URLs for the realistic tree / building models used in the CAD simulator.
import leafy from "@/assets/models/tree_gn-compressed.glb.asset.json";
import coconutPalm from "@/assets/models/coconut_palm.glb.asset.json";
import coconut from "@/assets/models/coconut_tree.glb.asset.json";
import mango from "@/assets/models/mango_tree.glb.asset.json";
import venice from "@/assets/models/venice_building.glb.asset.json";
import ichijoushi from "@/assets/models/ichijoushi_007_building.glb.asset.json";
import type { BuildingAsset, TreeSpecies } from "@/lib/cad-model";

export const TREE_MODELS: Record<Exclude<TreeSpecies, "generic">, string> = {
  leafy: leafy.url,
  coconut: coconut.url,
  coconut_palm: coconutPalm.url,
  mango: mango.url,
};

export const TREE_OPTIONS: Array<{ value: TreeSpecies; label: string }> = [
  { value: "generic", label: "Simple" },
  { value: "leafy", label: "Leafy tree" },
  { value: "coconut", label: "Coconut" },
  { value: "coconut_palm", label: "Coconut palm" },
  { value: "mango", label: "Mango" },
];

export const BUILDING_MODELS: Record<BuildingAsset, string> = {
  venice: venice.url,
  ichijoushi: ichijoushi.url,
};

export const BUILDING_OPTIONS: Array<{ value: BuildingAsset; label: string }> = [
  { value: "venice", label: "Venice house" },
  { value: "ichijoushi", label: "Townhouse" },
];
