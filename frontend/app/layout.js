import "./globals.css";

export const metadata = {
  title: "Healthcare RAG - Regulatory Compliance",
  description: "AI-powered healthcare regulatory compliance assistant",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
