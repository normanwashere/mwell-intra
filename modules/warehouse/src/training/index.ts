import { getTrainingAdapter, registerTrainingAdapter } from "@intra/learning";
import { receivingTrainingAdapter } from "./receivingAdapter";

export function registerWarehouseTrainingAdapters(): void {
  if (getTrainingAdapter(receivingTrainingAdapter.id)) return;
  registerTrainingAdapter(receivingTrainingAdapter);
}

export * from "./receivingAdapter";
