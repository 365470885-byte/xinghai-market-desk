import type { Metadata } from "next";
import { StockTerminal } from "./terminal";

export const metadata: Metadata = {
  title: "星辰大海 · 市场研究台",
  description: "高频自选行情与资金流向一体化研究桌面。",
};

export default function Home() {
  return <StockTerminal />;
}
