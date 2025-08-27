import "./globals.css";
import Providers from "./providers";

export const metadata = {
  title: "Zero Gravity Runner",
  description: "Game integrated with Monad Games ID (Testnet)",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-br">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
