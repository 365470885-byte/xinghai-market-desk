import type { Metadata } from "next";
import { StockTerminal } from "./terminal";

export const metadata: Metadata = {
  title: "星辰大海 · 市场研究台",
  description: "自选行情、板块强弱与资金流向的一体化研究桌面。",
};

export default function Home() {
  return <StockTerminal />;
}
