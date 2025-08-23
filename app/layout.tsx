import "./globals.css";
import Providers from "./providers";

export const metadata = {
  title: "Gravity Flip Runner — Mission 7",
  description: "Game demo integrated with Monad Games ID (Testnet)",
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
