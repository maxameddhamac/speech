import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Vox Studio — Voice-powered content creator",
  description: "Turn a voice recording into a polished transcript, summary, and studio-quality speech.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
