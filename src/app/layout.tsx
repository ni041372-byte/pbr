// src/app/layout.tsx
import './globals.css'; // Assuming you have a globals.css for global styles

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
