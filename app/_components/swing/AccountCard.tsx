"use client";
// app/_components/swing/AccountCard.tsx — one account against its month:
// the stop ↔ target bar, money at risk, profit locked by stops, slots.

import { kit as s, MonthBar, Slots, Stat, Tag, usd } from "./kit";
import type { Ledger, SwingAccountCfg } from "@/lib/swing/core";

export default function AccountCard({ a, extra }: { a: SwingAccountCfg & { ledger: Ledger }; extra?: React.ReactNode }) {
  const L = a.ledger;
  return (
    <div className={s.card} style={{ display: "grid", gap: 14 }}>
      <div className={s.spread}>
        <span style={{ fontWeight: 600, fontSize: 15 }}>{a.name}</span>
        <span className={s.mono} style={{ color: "var(--text-2)", fontSize: 13 }}>{usd(a.balance)}</span>
      </div>
      {L.stopHit ? <Tag tone="bad">MONTHLY STOP HIT — done until the 1st</Tag> : null}
      <MonthBar stop={a.monthlyStop} target={a.monthlyTarget} realised={L.realised} worst={L.worstCase} />
      <div className={s.stats}>
        <Stat k="at risk" v={usd(L.openRisk)} />
        <Stat k="locked" v={usd(L.locked)} tone={L.locked > 0 ? "green" : undefined} />
        <Stat k="slots" v={<Slots used={L.slotsUsed} max={a.maxSlots} />} />
      </div>
      {extra}
    </div>
  );
}
