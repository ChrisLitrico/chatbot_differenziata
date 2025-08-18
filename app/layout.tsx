import "./globals.css";
import { Inter } from "next/font/google";

const inter = Inter({ subsets: ["latin"] });

export const metadata = {
  title: "Differenziata in Sicilia",
  description: "Guida alla raccolta differenziata in Sicilia.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={`bg-violet-200 pt-6 ${inter.className}`}>
        {children}
      </body>
    </html>
  );
}
