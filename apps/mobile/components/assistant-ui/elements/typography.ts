import { Platform } from "react-native";

// System fonts preserve the reading feel without shipping a font asset.
export const readingFontFamily = Platform.select({
  ios: "SongtiSC-Regular",
  android: "serif",
  default: "serif",
}) ?? "serif";

export const readingBoldFontFamily = Platform.select({
  ios: "SongtiSC-Bold",
  android: "serif",
  default: "serif",
}) ?? "serif";
