import { ImageResponse } from "next/og";

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: 9,
          background: "linear-gradient(145deg, #8d6be8, #6945ca)",
          color: "white",
          fontSize: 15,
          fontWeight: 800,
          letterSpacing: -1,
        }}
      >
        MM
      </div>
    ),
    size,
  );
}
