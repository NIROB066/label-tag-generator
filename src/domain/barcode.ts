import bwipjs from "bwip-js";
import { Gs1Payload } from "@/domain/label-schema";

export type BarcodeOptions = {
  scale?: number;
  height?: number;
};

export async function generateGs1BarcodePng(
  payload: Gs1Payload,
  options: BarcodeOptions = {},
): Promise<Buffer> {
  return bwipjs.toBuffer({
    bcid: "gs1-128",
    text: payload.humanReadable,
    scale: options.scale ?? 4,
    height: options.height ?? 15,
    includetext: false,
    monochrome: true,
    paddingwidth: 10,
    paddingheight: 4,
  });
}
