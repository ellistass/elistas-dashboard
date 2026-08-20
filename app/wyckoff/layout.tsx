// app/wyckoff/layout.tsx — shell for the five Wyckoff surfaces.
//
// The page used to be one 1180px column with the benchmark, the watchlist, the
// desk, the archive and two drawers stacked vertically, every section at the
// same visual weight. Splitting it into routes is the fix; this layout is what
// keeps them feeling like one tool — a single data fetch and a persistent
// header, so moving between surfaces never loses the numbers or refetches.

import { WyckoffProvider } from "./_components/WyckoffData";
import WyckoffStrip from "./_components/WyckoffStrip";

export default function WyckoffLayout({ children }: { children: React.ReactNode }) {
  return (
    <WyckoffProvider>
      <div style={{ maxWidth: 1180, margin: "0 auto" }}>
        <WyckoffStrip />
        {children}
      </div>
    </WyckoffProvider>
  );
}
